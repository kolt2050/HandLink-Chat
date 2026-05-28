import type { ChatImageAttachment } from '../core/trackerChat'

export interface InviteData {
  version: 1
  roomId: Uint8Array
  sharedSecret: Uint8Array
  mailboxSeed: Uint8Array
}

export interface StoredInvite {
  id?: number
  invite: string
  mailboxKey: string
  chatName?: string
  createdAt: number
}

export interface StoredChatMessage {
  id: string
  mailboxKey: string
  author: string
  authorPeerId?: string
  text: string
  image?: ChatImageAttachment
  timestamp: number
  direction: 'in' | 'out' | 'system'
  mentionPeerIds?: string[]
}
