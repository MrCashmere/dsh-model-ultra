/** Small client helpers shared across components. */

import type { TFunc } from '../shared/types'

/** Friendly label for an llm-pi-ai protocol value. */
export function protoLabel(api: string, t: TFunc): string {
  if (api === 'openai-responses') return t('protoOpenaiResponses')
  if (api === 'anthropic-messages') return t('protoAnthropic')
  if (api === 'openai-completions') return t('protoOpenaiCompat')
  return api || '—'
}

/** Host part of a baseURL, for compact chips. */
export function hostOf(url: string): string {
  if (!url) return ''
  try {
    return url.replace(/^https?:\/\//, '').split('/')[0].replace(/[?#].*$/, '') || url
  } catch {
    return url
  }
}

/** Replace {token} placeholders in a translated string. */
export function fmt(template: string, tokens: Record<string, string | number>): string {
  return Object.entries(tokens).reduce<string>(
    (acc, [k, v]) => acc.split(`{${k}}`).join(String(v)),
    template,
  )
}
