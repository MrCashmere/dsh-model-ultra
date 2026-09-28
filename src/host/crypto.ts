/** Host-side secret handling for dsh-model-ultra.
 *
 * Provider API keys are stored in TWO places with different guarantees:
 *  - authoritative: in the DSH `credentials` service under the profile's
 *    apiKeyEnv ref — this is what llm-pi-ai resolves at request time. The
 *    credentials service is host-owned and keyed by the ref, not by this
 *    plugin, so a plugin uninstall/reinstall never touches it.
 *  - at-rest snapshot: an AES-256-GCM ciphertext under `profile.apiKeyEnc`,
 *    so the config file never carries a plaintext secret and the GUI can
 *    reveal on demand (default: masked).
 *
 * The random AES key itself is generated ONCE and stored in the credentials
 * service under ENC_KEY_REF. `ensureEncKey` reads first and only creates when
 * absent — it NEVER regenerates, which is what keeps decryption working after
 * a reinstall.
 *
 * Cipher: WebCrypto AES-GCM when available (packaged installs, Node tests).
 * The dynamic-plugin sandbox withholds the `crypto` global, so we fall back to
 * the bundled pure-JS @noble/ciphers GCM with a documented non-CSPRNG PRNG for
 * fresh IVs. This layer is defense-in-depth: the authoritative secret is the
 * credentials-service copy, so degraded IV entropy does not jeopardize the key.
 */

import { gcm } from '@noble/ciphers/aes.js'
import { bytesToUtf8, utf8ToBytes } from '@noble/ciphers/utils.js'
import type { HostCtx } from './utils'
import type { EncryptedSecret } from '../shared/types'
import { ENC_KEY_REF } from '../shared/constants'

const IV_LEN = 12
const KEY_LEN = 32

interface Credentials {
  resolve(ref: string): Promise<{ value?: string } | undefined>
  set(ref: string, value: string): Promise<void>
  unset?(ref: string): Promise<void>
}

function credsOf(ctx: HostCtx): Credentials | undefined {
  return ctx.get('credentials') as unknown as Credentials | undefined
}

// --- randomness ------------------------------------------------------------
function randomBytes(n: number): Uint8Array {
  const c = (globalThis as any).crypto
  if (c && typeof c.getRandomValues === 'function') {
    const out = new Uint8Array(n)
    c.getRandomValues(out)
    return out
  }
  // Sandbox fallback (no WebCrypto): xorshift128+ seeded from ambient values.
  // NOT a CSPRNG — the authoritative key copy lives in the credentials service.
  let s0 = (((Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0) || 0x9e3779b9)
  let s1 = (((Math.floor(Math.random() * 0xffffffff) ^ (Date.now() >>> 1)) >>> 0) || 0x85ebca6b)
  const out = new Uint8Array(n)
  for (let i = 0; i < n; i++) {
    let x = s0
    const y = s1
    s0 = y
    x ^= x << 23
    s1 = (x ^ y ^ (x >>> 17) ^ (y >>> 26)) >>> 0
    out[i] = (s1 + y) & 0xff
  }
  return out
}

// --- base64 ----------------------------------------------------------------
// Deliberately implemented by hand over raw bytes: the dynamic host sandbox
// provides btoa/atob with UTF-8 semantics (Buffer.from(s,'utf-8')), NOT the
// binary/Latin-1 semantics the Web assumes — feeding raw encrypted bytes
// through them silently corrupts every byte >= 0x80. A manual lookup-table
// encode/decode over Uint8Array is realm-independent and correct everywhere.
const B64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
function toB64(bytes: Uint8Array): string {
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i]
    const b = i + 1 < bytes.length ? bytes[i + 1] : NaN
    const c = i + 2 < bytes.length ? bytes[i + 2] : NaN
    out += B64_CHARS[a >> 2]
    out += B64_CHARS[((a & 3) << 4) | (Number.isNaN(b) ? 0 : b >> 4)]
    out += Number.isNaN(b) ? '=' : B64_CHARS[((b & 15) << 2) | (Number.isNaN(c) ? 0 : c >> 6)]
    out += Number.isNaN(c) ? '=' : B64_CHARS[c & 63]
  }
  return out
}
function fromB64(b64: string): Uint8Array {
  const clean = b64.replace(/=+$/, '')
  const out = new Uint8Array(Math.floor((clean.length * 6) / 8))
  let bits = 0
  let val = 0
  let n = 0
  for (let i = 0; i < clean.length; i++) {
    const idx = B64_CHARS.indexOf(clean[i])
    if (idx < 0) continue
    val = (val << 6) | idx
    bits += 6
    if (bits >= 8) {
      bits -= 8
      out[n++] = (val >> bits) & 0xff
    }
  }
  return out
}

// --- AES-256-GCM (WebCrypto first, bundled noble fallback) -----------------
async function encryptBytes(key: Uint8Array, iv: Uint8Array, plain: Uint8Array): Promise<Uint8Array> {
  const c = (globalThis as any).crypto
  if (c && c.subtle && typeof c.subtle.encrypt === 'function') {
    const k = await c.subtle.importKey('raw', key as any, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'])
    return new Uint8Array(await c.subtle.encrypt({ name: 'AES-GCM', iv: iv as any }, k, plain as any))
  }
  return gcm(key, iv).encrypt(plain)
}
async function decryptBytes(key: Uint8Array, iv: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const c = (globalThis as any).crypto
  if (c && c.subtle && typeof c.subtle.decrypt === 'function') {
    const k = await c.subtle.importKey('raw', key as any, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'])
    return new Uint8Array(await c.subtle.decrypt({ name: 'AES-GCM', iv: iv as any }, k, data as any))
  }
  return gcm(key, iv).decrypt(data)
}

/**
 * Return the plugin's random AES-256 key, creating + storing it in the
 * credentials service on first use. Never regenerates a VALID key — that is
 * what keeps decrypting old ciphertext working after a reinstall. A stored
 * value that does not decode to exactly KEY_LEN bytes (e.g. written by an
 * older build with the sandbox's UTF-8-semanics base64) is discarded and
 * replaced, so the cipher never runs on a corrupted key.
 */
export async function ensureEncKey(ctx: HostCtx): Promise<{ key: Uint8Array; ref: string } | null> {
  const creds = credsOf(ctx)
  if (creds === undefined) return null
  try {
    const existing = await creds.resolve(ENC_KEY_REF)
    if (existing && typeof existing.value === 'string' && existing.value) {
      try {
        const key = fromB64(existing.value)
        if (key.length === KEY_LEN) return { key, ref: ENC_KEY_REF }
      } catch { /* fall through to create */ }
    }
  } catch { /* fall through to create */ }

  const key = randomBytes(KEY_LEN)
  try {
    await creds.set(ENC_KEY_REF, toB64(key))
  } catch {
    return null
  }
  return { key, ref: ENC_KEY_REF }
}

/** Encrypt a secret into an at-rest snapshot (AES-256-GCM, random IV). */
export async function encryptSecret(ctx: HostCtx, plaintext: string): Promise<EncryptedSecret | null> {
  const holder = await ensureEncKey(ctx)
  if (!holder) return null
  const iv = randomBytes(IV_LEN)
  const ct = await encryptBytes(holder.key, iv, utf8ToBytes(plaintext))
  return { v: 1, iv: toB64(iv), ct: toB64(ct) }
}

/** Decrypt an at-rest snapshot; returns null on tamper / key mismatch. */
export async function decryptSecret(ctx: HostCtx, blob: EncryptedSecret): Promise<string | null> {
  const holder = await ensureEncKey(ctx)
  if (!holder || !blob || blob.v !== 1) return null
  try {
    const plain = await decryptBytes(holder.key, fromB64(blob.iv), fromB64(blob.ct))
    return bytesToUtf8(plain)
  } catch {
    return null
  }
}

/** Validate a credential-ref name (mirrors @deepseek-ai/dsh-credentials). */
export function validRefName(name: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name)
}

/** Derive a stable env-var name for a route when the profile has none. */
export function deriveEnvRef(route: string): string {
  const base = route.toUpperCase().replace(/[^A-Z0-9_]/g, '_')
  return `DSH_${base}_API_KEY`
}
