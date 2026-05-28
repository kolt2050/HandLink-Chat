import { decryptPayload, encryptPayload } from './crypto'
import { bytesToString, stringToBytes } from './encoding'
import { mailboxKeyFromInvite, parseInvite } from './invite'

const RTC_CONFIG: RTCConfiguration = {
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
}

const DATA_CHANNEL_CHUNK_SIZE = 48 * 1024

export interface ChatMessage {
  id: string
  author: string
  authorPeerId?: string
  text: string
  image?: ChatImageAttachment
  timestamp: number
  direction: 'in' | 'out' | 'system'
  mentionPeerIds?: string[]
}

export interface ChatImageAttachment {
  dataUrl: string
  mimeType: string
  name?: string
  width: number
  height: number
  size: number
}

export interface ChatPeer {
  id: string
  name: string
}

interface WireMessage {
  id: string
  author: string
  authorPeerId?: string
  text: string
  image?: ChatImageAttachment
  timestamp: number
  kind?: 'message' | 'system'
  mentionPeerIds?: string[]
}

interface WirePayload {
  type: 'message' | 'history' | 'presence' | 'mesh-offer' | 'mesh-answer'
  message?: WireMessage
  messages?: WireMessage[]
  peer?: ChatPeer
  peers?: ChatPeer[]
  from?: ChatPeer
  to?: string
  signalId?: string
  description?: RTCSessionDescriptionInit
}

interface ChunkPayload {
  type: 'chunk'
  id: string
  index: number
  total: number
  data: string
}

type ManualSignal =
  | { type: 'offer'; description: RTCSessionDescriptionInit }
  | { type: 'answer'; description: RTCSessionDescriptionInit }

export interface TrackerChatCallbacks {
  onLog(message: string): void
  onMessage(message: ChatMessage): void
  onHistory(messages: ChatMessage[]): void
  onPeer(peer: ChatPeer): void
  onPeerLeft(peerId: string): void
  onStatus(status: string): void
  getHistory(): ChatMessage[]
  getLocalPeer(): ChatPeer
  getKnownPeers(): ChatPeer[]
}

export class TrackerChatSession {
  private manualPcs = new Set<RTCPeerConnection>()
  private manualChannels = new Set<RTCDataChannel>()
  private pendingManualPc?: RTCPeerConnection
  private pendingMeshPcs = new Map<string, RTCPeerConnection>()
  private meshAttempts = new Set<string>()
  private seenRawPayloads: string[] = []
  private sharedSecret?: Uint8Array
  private channelPeers = new Map<RTCDataChannel, string>()
  private incomingChunks = new Map<string, { parts: string[]; received: number; total: number }>()

  constructor(private readonly callbacks: TrackerChatCallbacks) {}

  async sendExisting(message: ChatMessage): Promise<void> {
    if (!this.hasOpenSender()) throw new Error('Chat data channel is not open yet.')
    if (this.sharedSecret == null) throw new Error('Missing chat encryption key.')

    const wireMessage: WireMessage = {
      id: message.id,
      author: message.author,
      authorPeerId: message.authorPeerId,
      text: message.text,
      image: message.image,
      timestamp: message.timestamp,
      kind: message.direction === 'system' ? 'system' : 'message',
      mentionPeerIds: message.mentionPeerIds
    }
    const encrypted = await encryptPayload(this.sharedSecret, stringToBytes(JSON.stringify({ type: 'message', message: wireMessage } satisfies WirePayload)))
    const raw = JSON.stringify(encrypted)
    this.markRawSeen(raw)
    this.broadcastRaw(raw)
  }

  async createManualOffer(invite: string): Promise<string> {
    await this.prepareManualKey(invite)
    const pc = this.createManualPeerConnection()
    this.pendingManualPc = pc
    const channel = pc.createDataChannel('chat')
    this.bindManualChannel(channel)
    const offer = await pc.createOffer()
    await pc.setLocalDescription(offer)
    await waitForIceGathering(pc)
    this.callbacks.onStatus('manual offer ready')
    this.callbacks.onLog('Manual WebRTC offer created. Send it to the other user.')
    return encodeManualSignal({ type: 'offer', description: pc.localDescription! })
  }

  async acceptManualSignal(invite: string, signalText: string): Promise<string> {
    await this.prepareManualKey(invite)
    const signal = decodeManualSignal(signalText)

    if (signal.type === 'offer') {
      const pc = this.createManualPeerConnection()
      await pc.setRemoteDescription(signal.description)
      const answer = await pc.createAnswer()
      await pc.setLocalDescription(answer)
      await waitForIceGathering(pc)
      this.callbacks.onStatus('manual answer ready')
      this.callbacks.onLog('Manual WebRTC offer accepted. Send the generated answer back.')
      return encodeManualSignal({ type: 'answer', description: pc.localDescription! })
    }

    if (this.pendingManualPc == null) throw new Error('Create a manual offer before applying an answer.')
    await this.pendingManualPc.setRemoteDescription(signal.description)
    this.pendingManualPc = undefined
    this.callbacks.onStatus('manual answer applied')
    this.callbacks.onLog('Manual WebRTC answer applied. Waiting for data channel to open.')
    return ''
  }

  stop(): void {
    this.closeManualPeers()
    this.callbacks.onStatus('disconnected')
  }

  private async receiveEncryptedMessage(raw: string, source?: RTCDataChannel): Promise<void> {
    const chunkedRaw = this.acceptRawChunk(raw)
    if (chunkedRaw === null) return
    raw = chunkedRaw

    if (this.sharedSecret == null) return
    if (this.hasSeenRaw(raw)) return
    this.markRawSeen(raw)
    const decrypted = await decryptPayload(this.sharedSecret, JSON.parse(raw))
    const payload = JSON.parse(bytesToString(decrypted)) as WirePayload | WireMessage
    if ('type' in payload && payload.type === 'history') {
      const messages = (payload.messages ?? []).map((message) => ({ ...message, direction: message.kind === 'system' ? 'system' as const : 'in' as const }))
      this.callbacks.onHistory(messages)
      this.callbacks.onLog(`Received history sync with ${messages.length} message(s).`)
      this.broadcastRaw(raw, source)
      return
    }

    if ('type' in payload && payload.type === 'presence' && payload.peer != null) {
      if (source != null && !this.channelPeers.has(source)) this.channelPeers.set(source, payload.peer.id)
      this.callbacks.onPeer(payload.peer)
      for (const peer of payload.peers ?? []) this.callbacks.onPeer(peer)
      this.broadcastRaw(raw, source)
      if (payload.peer.id !== this.callbacks.getLocalPeer().id) void this.ensureMeshConnection(payload.peer)
      for (const peer of payload.peers ?? []) {
        if (peer.id !== this.callbacks.getLocalPeer().id) void this.ensureMeshConnection(peer)
      }
      return
    }

    if ('type' in payload && payload.type === 'mesh-offer') {
      if (payload.from != null) this.callbacks.onPeer(payload.from)
      if (payload.to === this.callbacks.getLocalPeer().id && payload.description != null && payload.signalId != null && payload.from != null) {
        void this.acceptMeshOffer(payload.signalId, payload.from, payload.description)
      } else {
        this.broadcastRaw(raw, source)
      }
      return
    }

    if ('type' in payload && payload.type === 'mesh-answer') {
      if (payload.from != null) this.callbacks.onPeer(payload.from)
      if (payload.to === this.callbacks.getLocalPeer().id && payload.description != null && payload.signalId != null) {
        void this.applyMeshAnswer(payload.signalId, payload.description)
      } else {
        this.broadcastRaw(raw, source)
      }
      return
    }

    const message = 'type' in payload ? payload.message : payload
    if (message != null) {
      this.callbacks.onMessage({ ...message, direction: message.kind === 'system' ? 'system' : 'in' })
      this.broadcastRaw(raw, source)
    }
  }

  private async sendHistory(only?: RTCDataChannel): Promise<void> {
    if (!this.hasOpenSender() || this.sharedSecret == null) return
    const history = this.callbacks.getHistory()
      .map(({ id, author, authorPeerId, text, image, timestamp, direction, mentionPeerIds }) => ({ id, author, authorPeerId, text, image, timestamp, kind: direction === 'system' ? 'system' as const : 'message' as const, mentionPeerIds }))
    const encrypted = await encryptPayload(this.sharedSecret, stringToBytes(JSON.stringify({ type: 'history', messages: history } satisfies WirePayload)))
    const raw = JSON.stringify(encrypted)
    this.markRawSeen(raw)
    this.broadcastRaw(raw, undefined, only)
    this.callbacks.onLog(`Sent history sync with ${history.length} message(s).`)
  }

  private async sendPresence(only?: RTCDataChannel): Promise<void> {
    if (!this.hasOpenSender() || this.sharedSecret == null) return
    const localPeer = this.callbacks.getLocalPeer()
    const peers = this.callbacks.getKnownPeers()
      .filter((peer) => peer.id !== localPeer.id)
    const encrypted = await encryptPayload(this.sharedSecret, stringToBytes(JSON.stringify({
      type: 'presence',
      peer: localPeer,
      peers
    } satisfies WirePayload)))
    const raw = JSON.stringify(encrypted)
    this.markRawSeen(raw)
    this.broadcastRaw(raw, undefined, only)
  }

  private async sendMeshPayload(payload: WirePayload): Promise<void> {
    if (!this.hasOpenSender() || this.sharedSecret == null) return
    const encrypted = await encryptPayload(this.sharedSecret, stringToBytes(JSON.stringify(payload)))
    const raw = JSON.stringify(encrypted)
    this.markRawSeen(raw)
    this.broadcastRaw(raw)
  }

  private async ensureMeshConnection(peer: ChatPeer): Promise<void> {
    const localPeer = this.callbacks.getLocalPeer()
    if (peer.id === localPeer.id || this.hasChannelToPeer(peer.id)) return
    const pairKey = [localPeer.id, peer.id].sort().join(':')
    if (this.meshAttempts.has(pairKey)) return
    this.meshAttempts.add(pairKey)
    if (localPeer.id > peer.id) return

    const signalId = crypto.randomUUID()
    const pc = this.createManualPeerConnection()
    this.pendingMeshPcs.set(signalId, pc)
    const channel = pc.createDataChannel('chat')
    this.channelPeers.set(channel, peer.id)
    this.bindManualChannel(channel)
    const offer = await pc.createOffer()
    await pc.setLocalDescription(offer)
    await waitForIceGathering(pc)
    await this.sendMeshPayload({
      type: 'mesh-offer',
      from: localPeer,
      to: peer.id,
      signalId,
      description: pc.localDescription!
    })
    this.callbacks.onLog(`Mesh WebRTC offer created for ${peer.name}.`)
  }

  private async acceptMeshOffer(signalId: string, from: ChatPeer, description: RTCSessionDescriptionInit): Promise<void> {
    if (this.hasChannelToPeer(from.id)) return
    const localPeer = this.callbacks.getLocalPeer()
    this.meshAttempts.add([localPeer.id, from.id].sort().join(':'))
    const pc = this.createManualPeerConnection()
    await pc.setRemoteDescription(description)
    const answer = await pc.createAnswer()
    await pc.setLocalDescription(answer)
    await waitForIceGathering(pc)
    await this.sendMeshPayload({
      type: 'mesh-answer',
      from: localPeer,
      to: from.id,
      signalId,
      description: pc.localDescription!
    })
    this.callbacks.onLog(`Mesh WebRTC answer created for ${from.name}.`)
  }

  private async applyMeshAnswer(signalId: string, description: RTCSessionDescriptionInit): Promise<void> {
    const pc = this.pendingMeshPcs.get(signalId)
    if (pc == null) return
    await pc.setRemoteDescription(description)
    this.pendingMeshPcs.delete(signalId)
    this.callbacks.onLog('Mesh WebRTC answer applied.')
  }

  private async prepareManualKey(invite: string): Promise<void> {
    const parsed = parseInvite(invite)
    const mailboxKey = await mailboxKeyFromInvite(invite)
    this.sharedSecret = parsed.sharedSecret
    this.callbacks.onLog(`Manual chat topic derived from mailbox key ${mailboxKey.slice(0, 18)}...`)
  }

  private createManualPeerConnection(): RTCPeerConnection {
    const pc = new RTCPeerConnection(RTC_CONFIG)
    this.manualPcs.add(pc)
    pc.ondatachannel = (event) => this.bindManualChannel(event.channel)
    pc.onconnectionstatechange = () => {
      this.callbacks.onLog(`Manual WebRTC connection state: ${pc.connectionState}`)
      if (pc.connectionState === 'connected') this.callbacks.onStatus('connected')
      if (pc.connectionState === 'closed' || pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
        this.manualPcs.delete(pc)
      }
    }
    pc.oniceconnectionstatechange = () => {
      this.callbacks.onLog(`Manual ICE state: ${pc.iceConnectionState}`)
    }
    return pc
  }

  private bindManualChannel(channel: RTCDataChannel): void {
    this.manualChannels.add(channel)
    channel.onopen = () => {
      this.callbacks.onStatus('connected')
      this.callbacks.onLog(`Manual RTCDataChannel opened. Open channels: ${this.openManualChannelCount()}.`)
      void this.sendPresence(channel)
      void this.sendHistory(channel)
    }
    channel.onclose = () => {
      const peerId = this.channelPeers.get(channel)
      if (peerId != null) {
        this.channelPeers.delete(channel)
        if (![...this.channelPeers.values()].includes(peerId)) this.callbacks.onPeerLeft(peerId)
      }
      this.manualChannels.delete(channel)
      this.callbacks.onLog(`Manual RTCDataChannel closed. Open channels: ${this.openManualChannelCount()}.`)
      if (this.openManualChannelCount() === 0) this.callbacks.onStatus('disconnected')
    }
    channel.onerror = () => this.callbacks.onLog('Manual RTCDataChannel error.')
    channel.onmessage = (event) => void this.receiveEncryptedMessage(String(event.data), channel)
  }

  private closeManualPeers(): void {
    for (const channel of this.manualChannels) channel.close()
    this.manualChannels.clear()
    for (const pc of this.manualPcs) pc.close()
    this.manualPcs.clear()
    this.pendingManualPc = undefined
    this.incomingChunks.clear()
  }

  private acceptRawChunk(raw: string): string | null {
    const chunk = parseChunkPayload(raw)
    if (chunk == null) return raw
    if (chunk.total <= 1) return chunk.data

    const current = this.incomingChunks.get(chunk.id) ?? {
      parts: Array<string>(chunk.total),
      received: 0,
      total: chunk.total
    }
    if (current.parts[chunk.index] == null) {
      current.parts[chunk.index] = chunk.data
      current.received += 1
    }
    this.incomingChunks.set(chunk.id, current)

    if (current.received < current.total) return null
    this.incomingChunks.delete(chunk.id)
    return current.parts.join('')
  }

  private hasSeenRaw(raw: string): boolean {
    return this.seenRawPayloads.includes(raw)
  }

  private markRawSeen(raw: string): void {
    this.seenRawPayloads.push(raw)
    if (this.seenRawPayloads.length > 500) this.seenRawPayloads.splice(0, this.seenRawPayloads.length - 500)
  }

  private hasOpenSender(): boolean {
    return this.openManualChannelCount() > 0
  }

  private hasChannelToPeer(peerId: string): boolean {
    for (const [channel, mappedPeerId] of this.channelPeers) {
      if (mappedPeerId === peerId && channel.readyState === 'open') return true
    }
    return false
  }

  private broadcastRaw(raw: string, except?: RTCDataChannel, only?: RTCDataChannel): void {
    let sent = 0
    for (const channel of this.manualChannels) {
      if (only != null && channel !== only) continue
      if (channel === except || channel.readyState !== 'open') continue
      this.sendRaw(channel, raw)
      sent += 1
    }
    if (sent > 1) this.callbacks.onLog(`Relayed encrypted payload to ${sent} peer connection(s).`)
  }

  private sendRaw(channel: RTCDataChannel, raw: string): void {
    if (raw.length <= DATA_CHANNEL_CHUNK_SIZE) {
      channel.send(raw)
      return
    }

    const id = crypto.randomUUID()
    const total = Math.ceil(raw.length / DATA_CHANNEL_CHUNK_SIZE)
    for (let index = 0; index < total; index += 1) {
      const chunk: ChunkPayload = {
        type: 'chunk',
        id,
        index,
        total,
        data: raw.slice(index * DATA_CHANNEL_CHUNK_SIZE, (index + 1) * DATA_CHANNEL_CHUNK_SIZE)
      }
      channel.send(JSON.stringify(chunk))
    }
    this.callbacks.onLog(`Sent encrypted payload in ${total} chunk(s).`)
  }

  private openManualChannelCount(): number {
    let count = 0
    for (const channel of this.manualChannels) {
      if (channel.readyState === 'open') count += 1
    }
    return count
  }
}

function parseChunkPayload(raw: string): ChunkPayload | null {
  try {
    const parsed = JSON.parse(raw) as Partial<ChunkPayload>
    if (
      parsed.type === 'chunk' &&
      typeof parsed.id === 'string' &&
      typeof parsed.index === 'number' &&
      typeof parsed.total === 'number' &&
      typeof parsed.data === 'string' &&
      parsed.index >= 0 &&
      parsed.index < parsed.total
    ) {
      return parsed as ChunkPayload
    }
  } catch {
    return null
  }
  return null
}

function waitForIceGathering(pc: RTCPeerConnection): Promise<void> {
  if (pc.iceGatheringState === 'complete') return Promise.resolve()
  return new Promise((resolve) => {
    const timeout = globalThis.setTimeout(() => {
      pc.onicegatheringstatechange = null
      resolve()
    }, 3000)
    pc.onicegatheringstatechange = () => {
      if (pc.iceGatheringState === 'complete') {
        globalThis.clearTimeout(timeout)
        pc.onicegatheringstatechange = null
        resolve()
      }
    }
  })
}

function encodeManualSignal(signal: ManualSignal): string {
  return `p2p-sdp.${bytesToBase64Url(new TextEncoder().encode(JSON.stringify(signal)))}`
}

function decodeManualSignal(value: string): ManualSignal {
  const normalized = value.trim()
  if (!normalized.startsWith('p2p-sdp.')) throw new Error('Manual signal must start with p2p-sdp.')
  const raw = normalized.slice('p2p-sdp.'.length)
  return JSON.parse(new TextDecoder().decode(base64UrlToBytes(raw))) as ManualSignal
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
}

function base64UrlToBytes(value: string): Uint8Array {
  const padded = value.replaceAll('-', '+').replaceAll('_', '/').padEnd(Math.ceil(value.length / 4) * 4, '=')
  const binary = atob(padded)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}
