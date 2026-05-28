import { bytesToBase64Url, base64UrlToBytes, stringToBytes } from './encoding'

export interface EncryptedEnvelope {
  iv: string
  ciphertext: string
}

export function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length)
  crypto.getRandomValues(bytes)
  return bytes
}

function bufferSource(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  return copy.buffer
}

export async function sha256Base64Url(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bufferSource(bytes))
  return bytesToBase64Url(new Uint8Array(digest))
}

async function importSharedSecret(sharedSecret: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', bufferSource(sharedSecret), 'HKDF', false, ['deriveKey'])
}

export async function derivePayloadKey(sharedSecret: Uint8Array): Promise<CryptoKey> {
  const keyMaterial = await importSharedSecret(sharedSecret)
  return crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: bufferSource(stringToBytes('browser-extension-p2p-discovery-probe:v1')),
      info: bufferSource(stringToBytes('mailbox-payload-aes-gcm'))
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  )
}

export async function encryptPayload(sharedSecret: Uint8Array, payload: Uint8Array): Promise<EncryptedEnvelope> {
  const iv = randomBytes(12)
  const key = await derivePayloadKey(sharedSecret)
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: bufferSource(iv) }, key, bufferSource(payload))
  return {
    iv: bytesToBase64Url(iv),
    ciphertext: bytesToBase64Url(new Uint8Array(ciphertext))
  }
}

export async function decryptPayload(sharedSecret: Uint8Array, envelope: EncryptedEnvelope): Promise<Uint8Array> {
  const key = await derivePayloadKey(sharedSecret)
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: bufferSource(base64UrlToBytes(envelope.iv)) },
    key,
    bufferSource(base64UrlToBytes(envelope.ciphertext))
  )
  return new Uint8Array(plaintext)
}

export async function deriveMailboxKey(mailboxSeed: Uint8Array): Promise<string> {
  return sha256Base64Url(mailboxSeed)
}
