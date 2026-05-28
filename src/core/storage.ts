import Dexie, { type Table } from 'dexie'
import type { StoredChatMessage, StoredInvite } from '../types'

class ChatDb extends Dexie {
  invites!: Table<StoredInvite, number>
  chatMessages!: Table<StoredChatMessage, string>

  constructor() {
    super('p2p-discovery-probe')
    this.version(1).stores({
      invites: '++id, createdAt, adapterId, mailboxKey',
      diagnostics: '++id, createdAt, adapterId, context'
    })
    this.version(2).stores({
      invites: '++id, createdAt, adapterId, mailboxKey',
      diagnostics: '++id, createdAt, adapterId, context',
      chatMessages: 'id, mailboxKey, timestamp'
    })
    this.version(3).stores({
      invites: '++id, createdAt, adapterId, mailboxKey, chatName',
      diagnostics: '++id, createdAt, adapterId, context',
      chatMessages: 'id, mailboxKey, timestamp'
    })
    this.version(4).stores({
      invites: '++id, createdAt, mailboxKey, chatName',
      diagnostics: null,
      chatMessages: 'id, mailboxKey, timestamp'
    })
  }
}

export const db = new ChatDb()
