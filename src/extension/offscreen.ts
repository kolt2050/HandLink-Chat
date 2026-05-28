import { mailboxKeyFromInvite, createInvite, parseInvite } from '../core/invite'
import { db } from '../core/storage'
import { TrackerChatSession, type ChatMessage, type ChatPeer } from '../core/trackerChat'
import type { StoredChatMessage } from '../types'

const CHAT_MESSAGE_LIMIT = 1000
const READ_MENTION_LIMIT = 2000
const MENTION_BELL_COOLDOWN_MS = 1000

interface LogLine {
  id: string
  timestamp: number
  message: string
}

interface InviteOfferBundle {
  invite: string
  signal: string
  chatName?: string
  peerName?: string
}

interface RuntimeProfile {
  nickname: string
  chatName: string
  localPeerId: string
}

interface RuntimeSnapshot {
  invite: string
  joinInvite: string
  chatName: string
  mailboxKey: string
  logs: LogLine[]
  chatStatus: string
  chatMessages: ChatMessage[]
  connectedPeers: ChatPeer[]
  manualSignalOut: string
  unreadMentionIds: string[]
}

type RuntimeCommand =
  | { type: 'snapshot'; profile?: RuntimeProfile }
  | { type: 'profile'; profile: RuntimeProfile }
  | { type: 'createInviteOffer'; mode: 'new' | 'current'; profile: RuntimeProfile }
  | { type: 'acceptSignal'; signal: string; profile: RuntimeProfile }
  | { type: 'sendMessage'; text: string; image?: ChatMessage['image']; mentionPeerIds?: string[]; profile: RuntimeProfile }
  | { type: 'markMentionRead'; messageId: string }
  | { type: 'disconnect' }

let invite = ''
let joinInvite = ''
let mailboxKey = ''
let logs: LogLine[] = []
let chatStatus = 'disconnected'
let chatMessages: ChatMessage[] = []
let connectedPeers: ChatPeer[] = []
let manualSignalOut = ''
let unreadMentionIds: string[] = []
let readMentionIds = new Set<string>()
let chatSession: TrackerChatSession | null = null
let activeSessionInvite = ''
let activeSessionMailboxKey = ''
let mentionBellLastPlayedAt = 0
let mentionBellAudioContext: AudioContext | null = null
let profile: RuntimeProfile = {
  nickname: localStorage.getItem('p2p-chat:nickname') || '',
  chatName: '',
  localPeerId: localStorage.getItem('handlink-chat:peerId') || crypto.randomUUID()
}

localStorage.setItem('handlink-chat:peerId', profile.localPeerId)
const restorePromise = restoreLastRoom()

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  const command = message as { channel?: string; command?: RuntimeCommand }
  if (command.channel !== 'offscreen-command' || command.command == null) return
  void handleCommand(command.command)
    .then((snapshot) => sendResponse({ ok: true, snapshot }))
    .catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error), snapshot: snapshot() }))
  return true
})

async function handleCommand(command: RuntimeCommand): Promise<RuntimeSnapshot> {
  await restorePromise
  if ('profile' in command && command.profile != null) updateProfile(command.profile)

  switch (command.type) {
    case 'snapshot':
      break
    case 'profile':
      emitSnapshot()
      break
    case 'createInviteOffer':
      await createInviteOfferBundle(command.mode)
      break
    case 'acceptSignal':
      await acceptManualSignal(command.signal)
      break
    case 'sendMessage':
      await sendChatMessage(command.text, command.mentionPeerIds, command.image)
      break
    case 'markMentionRead':
      unreadMentionIds = unreadMentionIds.filter((id) => id !== command.messageId)
      markMentionRead(command.messageId)
      emitSnapshot()
      break
    case 'disconnect':
      await stopChat()
      break
  }

  return snapshot()
}

function updateProfile(nextProfile: RuntimeProfile) {
  profile = nextProfile
  if (nextProfile.nickname.trim()) localStorage.setItem('p2p-chat:nickname', nextProfile.nickname)
  localStorage.setItem('handlink-chat:peerId', nextProfile.localPeerId)
}

function snapshot(): RuntimeSnapshot {
  return {
    invite,
    joinInvite,
    chatName: '',
    mailboxKey,
    logs,
    chatStatus,
    chatMessages,
    connectedPeers,
    manualSignalOut,
    unreadMentionIds
  }
}

function emitSnapshot() {
  void chrome.runtime.sendMessage({ channel: 'offscreen-event', snapshot: snapshot() }).catch(() => undefined)
}

function appendLog(message: string) {
  logs = [{ id: crypto.randomUUID(), timestamp: Date.now(), message }, ...logs].slice(0, 80)
  emitSnapshot()
}

async function loadChatHistory(nextMailboxKey: string) {
  readMentionIds = loadReadMentionIds(nextMailboxKey)
  const stored = await db.chatMessages.where('mailboxKey').equals(nextMailboxKey).sortBy('timestamp')
  chatMessages = stored
    .slice(-CHAT_MESSAGE_LIMIT)
    .map(({ id, author, authorPeerId, text, image, timestamp, direction, mentionPeerIds }) => ({ id, author, authorPeerId, text, image, timestamp, direction, mentionPeerIds }))
  unreadMentionIds = chatMessages
    .filter((message) => isUnreadMention(message))
    .map((message) => message.id)
  if (stored.length > CHAT_MESSAGE_LIMIT) void pruneChatHistory(nextMailboxKey)
  appendLog(`Loaded ${chatMessages.length} saved chat message(s).`)
  emitSnapshot()
}

async function pruneChatHistory(nextMailboxKey: string) {
  const stored = await db.chatMessages.where('mailboxKey').equals(nextMailboxKey).sortBy('timestamp')
  const excess = stored.slice(0, Math.max(0, stored.length - CHAT_MESSAGE_LIMIT))
  if (excess.length === 0) return
  await db.chatMessages.bulkDelete(excess.map((message) => message.id))
  appendLog(`Pruned ${excess.length} old chat message(s); keeping latest ${CHAT_MESSAGE_LIMIT}.`)
}

async function clearLocalChatHistory(nextMailboxKey: string) {
  const visibleCount = chatMessages.length
  const deletedCount = await db.chatMessages.where('mailboxKey').equals(nextMailboxKey).delete()
  chatMessages = []
  unreadMentionIds = []
  if (deletedCount > 0 || visibleCount > 0) appendLog(`Cleared ${deletedCount} local chat message(s) for this room.`)
  emitSnapshot()
}

async function restoreLastRoom() {
  const savedMailboxKey = localStorage.getItem('p2p-chat:lastMailboxKey')
  const savedInvite = localStorage.getItem('p2p-chat:lastInvite')
  const latestInvite = savedMailboxKey
    ? await db.invites.where('mailboxKey').equals(savedMailboxKey).last()
    : await db.invites.orderBy('createdAt').last()
  const nextInvite = savedInvite || latestInvite?.invite
  const nextMailboxKey = latestInvite?.mailboxKey ?? (nextInvite ? await mailboxKeyFromInvite(nextInvite) : savedMailboxKey)
  if (!nextMailboxKey) {
    emitSnapshot()
    return
  }

  if (nextInvite) {
    invite = nextInvite
    joinInvite = nextInvite
    localStorage.setItem('p2p-chat:lastInvite', nextInvite)
  }
  mailboxKey = nextMailboxKey
  localStorage.setItem('p2p-chat:lastMailboxKey', nextMailboxKey)
  await loadChatHistory(nextMailboxKey)
  appendLog('Last room restored after page load.')
}

function rememberActiveRoom(nextInvite: string, nextMailboxKey: string) {
  localStorage.setItem('p2p-chat:lastInvite', nextInvite)
  localStorage.setItem('p2p-chat:lastMailboxKey', nextMailboxKey)
}

function currentRoomInvite() {
  return activeSessionInvite || joinInvite || invite
}

async function rememberChatMessage(message: ChatMessage, nextMailboxKey = mailboxKey) {
  if (!nextMailboxKey) return
  const normalized: StoredChatMessage = {
    id: message.id,
    mailboxKey: nextMailboxKey,
    author: message.author,
    authorPeerId: message.authorPeerId,
    text: message.text,
    image: message.image,
    timestamp: message.timestamp,
    direction: message.direction,
    mentionPeerIds: message.mentionPeerIds
  }
  await db.chatMessages.put(normalized)
}

function mergeChatMessages(messages: ChatMessage[], nextMailboxKey = mailboxKey) {
  const seen = new Set(chatMessages.map((message) => message.id))
  const merged = [...chatMessages]
  let changed = false
  let addedUnreadMention = false
  for (const message of messages) {
    if (seen.has(message.id)) continue
    seen.add(message.id)
    merged.push(message)
    if (isUnreadMention(message) && !unreadMentionIds.includes(message.id)) {
      unreadMentionIds = [...unreadMentionIds, message.id]
      addedUnreadMention = true
    }
    changed = true
    void rememberChatMessage(message, nextMailboxKey)
  }
  merged.sort((a, b) => a.timestamp - b.timestamp)
  chatMessages = merged.slice(-CHAT_MESSAGE_LIMIT)
  unreadMentionIds = unreadMentionIds.filter((id) => chatMessages.some((message) => message.id === id))
  if (addedUnreadMention) void playMentionBell()
  if (changed) void pruneChatHistory(nextMailboxKey)
  emitSnapshot()
}

async function playMentionBell() {
  const now = Date.now()
  if (now - mentionBellLastPlayedAt < MENTION_BELL_COOLDOWN_MS) return
  mentionBellLastPlayedAt = now

  try {
    mentionBellAudioContext ??= new AudioContext()
    const audioContext = mentionBellAudioContext
    if (audioContext.state === 'suspended') await audioContext.resume()

    const startAt = audioContext.currentTime + 0.03
    playBellTone(audioContext, startAt, 1046.5, 0.24)
    playBellTone(audioContext, startAt + 0.17, 1318.5, 0.18)
  } catch (error) {
    appendLog(`Mention bell playback failed: ${error instanceof Error ? error.message : String(error)}`)
  }
}

function playBellTone(audioContext: AudioContext, startAt: number, frequency: number, volume: number) {
  const oscillator = audioContext.createOscillator()
  const gain = audioContext.createGain()

  oscillator.type = 'triangle'
  oscillator.frequency.setValueAtTime(frequency, startAt)
  oscillator.frequency.exponentialRampToValueAtTime(frequency * 0.88, startAt + 0.34)

  gain.gain.setValueAtTime(0.0001, startAt)
  gain.gain.exponentialRampToValueAtTime(volume, startAt + 0.012)
  gain.gain.exponentialRampToValueAtTime(0.0001, startAt + 0.42)

  oscillator.connect(gain)
  gain.connect(audioContext.destination)
  oscillator.start(startAt)
  oscillator.stop(startAt + 0.46)
}

function isUnreadMention(message: ChatMessage) {
  return message.direction === 'in' && (message.mentionPeerIds ?? []).includes(profile.localPeerId) && !readMentionIds.has(message.id)
}

function readMentionStorageKey(nextMailboxKey = mailboxKey) {
  return `handlink-chat:readMentions:${nextMailboxKey}`
}

function loadReadMentionIds(nextMailboxKey: string) {
  try {
    const parsed = JSON.parse(localStorage.getItem(readMentionStorageKey(nextMailboxKey)) ?? '[]') as unknown
    return new Set(Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [])
  } catch {
    return new Set<string>()
  }
}

function saveReadMentionIds(nextMailboxKey = mailboxKey) {
  if (!nextMailboxKey) return
  const ids = [...readMentionIds].slice(-READ_MENTION_LIMIT)
  readMentionIds = new Set(ids)
  localStorage.setItem(readMentionStorageKey(nextMailboxKey), JSON.stringify(ids))
}

function markMentionRead(messageId: string) {
  if (!mailboxKey) return
  readMentionIds.add(messageId)
  saveReadMentionIds()
}

function rememberPeer(peer: ChatPeer) {
  if (peer.id === profile.localPeerId) return
  connectedPeers = [...connectedPeers.filter((item) => item.id !== peer.id), peer].sort((a, b) => a.name.localeCompare(b.name))
  emitSnapshot()
}

function forgetPeer(peerId: string) {
  connectedPeers = connectedPeers.filter((peer) => peer.id !== peerId)
  emitSnapshot()
}

function localPeer(): ChatPeer {
  return { id: profile.localPeerId, name: requireNickname() }
}

function addSystemInviteMessage(inviteeName: string, nextMailboxKey = mailboxKey) {
  const inviterName = requireNickname()
  const systemMessage: ChatMessage = {
    id: crypto.randomUUID(),
    author: 'system',
    text: `${inviterName} пригласил(а) в чат пользователя ${inviteeName}.`,
    timestamp: Date.now(),
    direction: 'system'
  }
  mergeChatMessages([systemMessage], nextMailboxKey)
  void chatSession?.sendExisting(systemMessage).catch((error) => appendLog(`Send failed: ${error instanceof Error ? error.message : String(error)}`))
}

async function ensureManualSession(chatInvite: string, nextMailboxKey: string) {
  if (chatSession != null && activeSessionMailboxKey === nextMailboxKey) return chatSession
  if (chatSession != null) {
    chatSession.stop()
    chatSession = null
    connectedPeers = []
    chatStatus = 'disconnected'
  }
  await loadChatHistory(nextMailboxKey)
  chatSession = new TrackerChatSession({
    onLog: appendLog,
    onMessage: (message) => mergeChatMessages([message], nextMailboxKey),
    onHistory: (messages) => mergeChatMessages(messages, nextMailboxKey),
    onPeer: rememberPeer,
    onPeerLeft: forgetPeer,
    getHistory: () => chatMessages,
    getLocalPeer: localPeer,
    getKnownPeers: () => connectedPeers,
    onStatus: (status) => {
      chatStatus = status
      if (status.toLowerCase().includes('disconnected')) connectedPeers = []
      emitSnapshot()
    }
  })
  appendLog('Manual WebRTC signaling session prepared.')
  parseInvite(chatInvite)
  activeSessionInvite = chatInvite
  activeSessionMailboxKey = nextMailboxKey
  return chatSession
}

async function createInviteOfferBundle(mode: 'new' | 'current') {
  const nickname = requireNickname()

  let chatInvite = mode === 'current' ? currentRoomInvite() : ''
  if (!chatInvite) {
    appendLog('Creating new chat and manual WebRTC offer bundle.')
    chatSession?.stop()
    chatSession = null
    activeSessionInvite = ''
    activeSessionMailboxKey = ''
    connectedPeers = []
    chatInvite = createInvite()
    const createdMailboxKey = await mailboxKeyFromInvite(chatInvite)
    invite = chatInvite
    joinInvite = chatInvite
    mailboxKey = createdMailboxKey
    rememberActiveRoom(chatInvite, createdMailboxKey)
    chatMessages = []
    unreadMentionIds = []
    readMentionIds = loadReadMentionIds(createdMailboxKey)
    await db.invites.add({ invite: chatInvite, mailboxKey: createdMailboxKey, createdAt: Date.now() })
  } else {
    appendLog('Creating invite offer for existing chat.')
  }

  const nextMailboxKey = await mailboxKeyFromInvite(chatInvite)
  invite = chatInvite
  joinInvite = chatInvite
  mailboxKey = nextMailboxKey
  rememberActiveRoom(chatInvite, nextMailboxKey)
  const session = await ensureManualSession(chatInvite, nextMailboxKey)
  const signal = await session.createManualOffer(chatInvite)
  manualSignalOut = encodeInviteOfferBundle({ invite: chatInvite, signal, peerName: nickname })
  appendLog('Invite + offer bundle created. Send this single text to the other user.')
  emitSnapshot()
}

async function acceptManualSignal(signalInput: string) {
  const nickname = requireNickname()
  if (!signalInput.trim()) throw new Error('Manual signal failed: paste invite+offer or answer first.')
  const parsed = decodeInviteSignalInput(signalInput)
  const chatInvite = parsed.invite ?? currentRoomInvite()
  if (!chatInvite) throw new Error('Manual signal failed: this answer does not contain an invite, so the original invite is required.')

  if (parsed.invite != null) {
    invite = parsed.invite
    joinInvite = parsed.invite
  }
  const nextMailboxKey = await mailboxKeyFromInvite(chatInvite)
  if (nextMailboxKey !== activeSessionMailboxKey) {
    chatSession?.stop()
    chatSession = null
    activeSessionInvite = ''
    activeSessionMailboxKey = ''
    connectedPeers = []
    chatStatus = 'disconnected'
    chatMessages = []
    unreadMentionIds = []
  }
  mailboxKey = nextMailboxKey
  rememberActiveRoom(chatInvite, nextMailboxKey)
  if (parsed.invite != null) {
    await db.invites.put({
      invite: chatInvite,
      mailboxKey: nextMailboxKey,
      createdAt: Date.now()
    })
  }
  const session = await ensureManualSession(chatInvite, nextMailboxKey)
  const response = await session.acceptManualSignal(chatInvite, parsed.signal)
  if (response) {
    manualSignalOut = encodeAnswerBundle(response, nickname)
    appendLog('Answer bundle created. Send it back to the first user.')
  } else if (parsed.peerName) {
    addSystemInviteMessage(parsed.peerName, nextMailboxKey)
  }
  emitSnapshot()
}

async function sendChatMessage(text: string, mentionPeerIds: string[] = [], image?: ChatMessage['image']) {
  const nickname = requireNickname()
  const normalizedText = text.trim()
  if (!normalizedText && image == null) return
  const chatInvite = currentRoomInvite()
  if (!chatInvite) throw new Error('Send failed: generate or paste an invite first.')
  const nextMailboxKey = mailboxKey || await mailboxKeyFromInvite(chatInvite)
  rememberActiveRoom(chatInvite, nextMailboxKey)
  const localMessage: ChatMessage = {
    id: crypto.randomUUID(),
    author: nickname,
    authorPeerId: profile.localPeerId,
    text: normalizedText,
    image,
    timestamp: Date.now(),
    direction: 'out',
    mentionPeerIds: mentionPeerIds.length > 0 ? mentionPeerIds : undefined
  }
  mergeChatMessages([localMessage], nextMailboxKey)
  if (chatStatus === 'connected') {
    await chatSession?.sendExisting(localMessage)
  } else {
    appendLog('Message saved locally and will sync when a peer connects.')
  }
}

function requireNickname() {
  const nickname = profile.nickname.trim()
  if (!nickname) throw new Error('Enter a nickname before using the chat.')
  return nickname
}

async function stopChat() {
  const activeInvite = currentRoomInvite()
  const activeMailboxKey = mailboxKey || (activeInvite ? await mailboxKeyFromInvite(activeInvite) : '')
  chatSession?.stop()
  chatSession = null
  activeSessionInvite = ''
  activeSessionMailboxKey = ''
  connectedPeers = []
  chatStatus = 'disconnected'
  unreadMentionIds = []
  if (activeMailboxKey) await clearLocalChatHistory(activeMailboxKey)
  appendLog('Chat stopped.')
  emitSnapshot()
}

function encodeInviteOfferBundle(bundle: InviteOfferBundle): string {
  return `p2p-chat.${bytesToBase64Url(new TextEncoder().encode(JSON.stringify({ v: 1, ...bundle })))}`
}

function encodeAnswerBundle(signal: string, peerName?: string): string {
  return `p2p-chat-answer.${bytesToBase64Url(new TextEncoder().encode(JSON.stringify({ v: 1, signal, peerName })))}`
}

function decodeInviteSignalInput(value: string): { invite?: string; signal: string; chatName?: string; peerName?: string } {
  const normalized = value.trim()
  if (normalized.startsWith('p2p-chat.')) {
    const payload = JSON.parse(new TextDecoder().decode(base64UrlToBytes(normalized.slice('p2p-chat.'.length)))) as Partial<InviteOfferBundle>
    if (!payload.invite || !payload.signal) throw new Error('Invite+offer bundle is malformed.')
    return { invite: payload.invite, signal: payload.signal, chatName: payload.chatName, peerName: payload.peerName }
  }
  if (normalized.startsWith('p2p-chat-answer.')) {
    const payload = JSON.parse(new TextDecoder().decode(base64UrlToBytes(normalized.slice('p2p-chat-answer.'.length)))) as { signal?: string; peerName?: string }
    if (!payload.signal) throw new Error('Answer bundle is malformed.')
    return { signal: payload.signal, peerName: payload.peerName }
  }
  return { signal: normalized }
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
