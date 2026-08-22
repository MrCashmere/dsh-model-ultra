/** UI preference handlers — the conversation badge toggle.
 *
 * Preferences persist under the llm-pi-ai settings section (UI_PREFS_KEY) so
 * they follow the profile across browsers and reloads. Kept deliberately tiny:
 * today only `showRouteBadge`, merged over defaults so future keys can be
 * added without a migration.
 */

import type { HostCtx } from '../utils'
import { readRoutesRootKey, writeRoutesRootKey, checkWritable } from '../utils'
import { UI_PREFS_KEY } from '../../shared/constants'

export interface UiPrefs {
  /** Show a small badge under each routed turn naming the provider/model that
   * actually served it (default: true). */
  showRouteBadge: boolean
}

const DEFAULTS: UiPrefs = { showRouteBadge: true }

function normalize(raw: unknown): UiPrefs {
  const out: UiPrefs = { ...DEFAULTS }
  if (raw && typeof raw === 'object') {
    const r = raw as Record<string, unknown>
    if (typeof r.showRouteBadge === 'boolean') out.showRouteBadge = r.showRouteBadge
  }
  return out
}

export async function getUiPrefs(ctx: HostCtx) {
  return { ok: true as const, prefs: normalize(readRoutesRootKey(ctx.get('settings'), UI_PREFS_KEY)) }
}

export async function setUiPrefs(ctx: HostCtx, args?: { prefs?: Partial<UiPrefs> }) {
  const st = ctx.get('settings')
  if (!st || !checkWritable(st)) return { ok: false as const, error: '设置只读，无法保存' }
  const patch = args?.prefs && typeof args.prefs === 'object' ? args.prefs : {}
  const merged = normalize({ ...normalize(readRoutesRootKey(st, UI_PREFS_KEY)), ...patch })
  await writeRoutesRootKey(st, UI_PREFS_KEY, merged)
  return { ok: true as const, prefs: merged }
}
