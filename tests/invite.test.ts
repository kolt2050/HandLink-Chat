import { describe, expect, it } from 'vitest'
import { decryptPayload, deriveMailboxKey, encryptPayload, randomBytes } from '../src/core/crypto'
import { base64UrlToBytes, bytesToBase64Url, stringToBytes, bytesToString } from '../src/core/encoding'
import { createInvite, encodeInvite, parseInvite } from '../src/core/invite'

describe('encoding', () => {
  it('round trips base64url bytes', () => {
    const bytes = new Uint8Array([0, 1, 2, 252, 253, 254, 255])
    expect(base64UrlToBytes(bytesToBase64Url(bytes))).toEqual(bytes)
  })
})

describe('invite', () => {
  it('generates a parseable copy-paste friendly invite', () => {
    const invite = createInvite()
    expect(invite.startsWith('bcp1.')).toBe(true)
    expect(invite).not.toContain('+')
    expect(invite).not.toContain('/')
    expect(invite).not.toContain('=')
    const parsed = parseInvite(invite)
    expect(parsed.version).toBe(1)
    expect(parsed.roomId).toHaveLength(16)
    expect(parsed.sharedSecret).toHaveLength(32)
    expect(parsed.mailboxSeed).toHaveLength(16)
  })

  it('preserves binary fields through encode and parse', () => {
    const data = {
      version: 1 as const,
      roomId: randomBytes(16),
      sharedSecret: randomBytes(32),
      mailboxSeed: randomBytes(16)
    }
    const parsed = parseInvite(encodeInvite(data))
    expect(parsed.roomId).toEqual(data.roomId)
    expect(parsed.sharedSecret).toEqual(data.sharedSecret)
    expect(parsed.mailboxSeed).toEqual(data.mailboxSeed)
  })
})

describe('crypto', () => {
  it('encrypts and decrypts mailbox payloads', async () => {
    const secret = randomBytes(32)
    const envelope = await encryptPayload(secret, stringToBytes('hello discovery'))
    const plaintext = await decryptPayload(secret, envelope)
    expect(bytesToString(plaintext)).toBe('hello discovery')
  })

  it('derives deterministic mailbox keys', async () => {
    const seed = randomBytes(16)
    await expect(deriveMailboxKey(seed)).resolves.toBe(await deriveMailboxKey(seed))
  })
})
