/** set-api-key handler — stores a provider's real API key:
 *  - authoritative plaintext in the DSH `credentials` service under the
 *    profile's env-ref (this is what llm-pi-ai resolves when a call is made),
 *  - an AES-256-GCM snapshot in the profile (`apiKeyEnc`) so the config file
 *    never carries plaintext and the GUI can reveal on demand.
 *  An empty `apiKey` clears both and removes the snapshot.
 *
 *  Reinstall-safe: the encryption key lives in the credentials service and is
 *  never regenerated, so old `apiKeyEnc` snapshots still decrypt after a
 *  plugin uninstall/reinstall. */

import type { HostCtx } from '../utils'
import { readProviders, readDisabled, readProfile, checkWritable, writeSection } from '../utils'
import { encryptSecret, deriveEnvRef, validRefName } from '../crypto'

type ProfileLike = Record<string, unknown>

export async function setApiKey(ctx: HostCtx, args: { route?: string; apiKey?: string }) {
  const st = ctx.get('settings')
  if (st === undefined) return { ok: false as const, error: 'settings 服务不可用' }
  if (!checkWritable(st)) return { ok: false as const, error: '设置只读' }
  const route = args?.route
  if (!route) return { ok: false as const, error: '缺少 route' }

  const providers = readProviders(st)
  const disabled = readDisabled(st)
  const p = readProfile(providers, route) || readProfile(disabled, route)
  if (!p) return { ok: false as const, error: `提供商 "${route}" 不存在` }

  const creds = ctx.get('credentials')
  if (creds === undefined) return { ok: false as const, error: '凭据服务不可用' }
  const key = typeof args?.apiKey === 'string' ? args.apiKey.trim() : ''

  // env-ref the adapter resolves: the profile's own, or a stable derived one.
  let envRef =
    typeof p.apiKeyEnv === 'string' && p.apiKeyEnv.trim() ? p.apiKeyEnv.trim() : deriveEnvRef(route)
  if (!validRefName(envRef)) return { ok: false as const, error: `无效的凭据名：${envRef}` }

  const apply = async (src: ProfileLike): Promise<ProfileLike> => {
    const cur: ProfileLike = {}
    for (const fk of Object.keys(src)) cur[fk] = src[fk]
    if (key) {
      const enc = await encryptSecret(ctx, key)
      if (!enc) throw new Error('无法加密密钥：凭据服务不可用')
      cur.apiKeyEnv = envRef
      cur.apiKeyEnc = enc
    } else {
      delete cur.apiKeyEnc
    }
    return cur
  }

  try {
    // Authoritative copy for the adapter (empty -> clear the stored key).
    if (key) await (creds as any).set(envRef, key)
    else if (typeof (creds as any).unset === 'function') {
      try { await (creds as any).unset(envRef) } catch { /* absent ref — no-op */ }
    }

    const nextProviders: Record<string, unknown> = {}
    for (const k of Object.keys(providers)) nextProviders[k] = k === route ? await apply(providers[k] as any) : (providers as any)[k]
    const nextDisabled: Record<string, unknown> = {}
    for (const k of Object.keys(disabled)) nextDisabled[k] = k === route ? await apply(disabled[k] as any) : (disabled as any)[k]

    await writeSection(st, nextProviders as any, nextDisabled as any)
  } catch (err) {
    return { ok: false as const, error: String((err as Error)?.message || err) }
  }

  return { ok: true as const, route, stored: !!key, envRef }
}
