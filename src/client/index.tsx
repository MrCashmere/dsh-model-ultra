/**
 * dsh-model-pro — Client half entry point.
 *
 * Registers a `settings.section` Slot that renders the Model Pro settings page.
 * The locale dictionaries (ZH/EN) and CSS are injected once; all data operations
 * go through host.call() RPC to the Host half.
 */

import { CLIENT_NS, ZH, EN } from './i18n'
import { CSS } from './styles'
import { createCall } from './rpc'
import { ModelProPage } from './components/ModelProPage'
import type { TFunc } from '../shared/types'
import React from './react'

export function apply(ctx: any) {
  const locale = ctx.get('locale') || ctx.locale
  if (locale !== undefined) {
    ctx.effect(() => {
      try {
        return locale.register(CLIENT_NS, { zh: ZH, en: EN })
      } catch (_e) {
        // namespace already registered from a prior run — safe to ignore
      }
    }, 'dsh-model-pro: dictionaries')
  }

  const t: TFunc = locale !== undefined ? locale.bind(CLIENT_NS) : (k: string) => k

  // `styles` is injected as a closure parameter by the Cordis client runner.
  styles.insert(CSS)

  const call = createCall(t)

  const slots = ctx.get('slots') || ctx.slots
  if (slots === undefined) return

  slots.inject('settings.section', () => {
    return slots.register(
      { name: 'settings.section', id: 'dsh-model-pro', order: 12, label: () => t('nav') },
      () => React.createElement(ModelProPage, { t, call }),
    )
  })
}

export { apply as default }
