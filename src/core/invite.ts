import { deriveMailboxKey, randomBytes } from './crypto'
import { base64UrlToBytes, bytesToBase64Url, bytesToString, stringToBytes } from './encoding'
import type { InviteData } from '../types'

const PREFIX = 'bcp1.'

interface InviteJson {
  version: 1
  roomId: string
  sharedSecret: string
  mailboxSeed: string
}

function assertLength(name: string, value: Uint8Array, expected: number): void {
  if (value.byteLength !== expected) {
    throw new Error(`${name} must be ${expected} bytes`)
  }
}

export function createInviteData(): InviteData {
  return {
    version: 1,
    roomId: randomBytes(16),
    sharedSecret: randomBytes(32),
    mailboxSeed: randomBytes(16)
  }
}

export function encodeInvite(data: InviteData): string {
  assertLength('roomId', data.roomId, 16)
  assertLength('sharedSecret', data.sharedSecret, 32)
  assertLength('mailboxSeed', data.mailboxSeed, 16)
  const json: InviteJson = {
    version: 1,
    roomId: bytesToBase64Url(data.roomId),
    sharedSecret: bytesToBase64Url(data.sharedSecret),
    mailboxSeed: bytesToBase64Url(data.mailboxSeed)
  }
  return `${PREFIX}${bytesToBase64Url(stringToBytes(JSON.stringify(json)))}`
}

export function createInvite(): string {
  return encodeInvite(createInviteData())
}

export function parseInvite(invite: string): InviteData {
  if (!invite.startsWith(PREFIX)) {
    throw new Error('Invite must start with bcp1.')
  }
  const raw = bytesToString(base64UrlToBytes(invite.slice(PREFIX.length)))
  const parsed = JSON.parse(raw) as InviteJson
  if (parsed.version !== 1) {
    throw new Error(`Unsupported invite version: ${String(parsed.version)}`)
  }
  const data: InviteData = {
    version: 1,
    roomId: base64UrlToBytes(parsed.roomId),
    sharedSecret: base64UrlToBytes(parsed.sharedSecret),
    mailboxSeed: base64UrlToBytes(parsed.mailboxSeed)
  }
  assertLength('roomId', data.roomId, 16)
  assertLength('sharedSecret', data.sharedSecret, 32)
  assertLength('mailboxSeed', data.mailboxSeed, 16)
  return data
}

export async function mailboxKeyFromInvite(invite: string): Promise<string> {
  return deriveMailboxKey(parseInvite(invite).mailboxSeed)
}
