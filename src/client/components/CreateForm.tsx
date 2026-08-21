/** CreateForm — the guided 3-step "connect a provider" wizard. Steps carry real
 * order (name → connection → credentials), then a create action. */

import React from '../react'
import type { CreateFormState, TFunc } from '../../shared/types'
import { protoLabel } from '../labels'

interface Props {
  t: TFunc
  form: CreateFormState
  set: (patch: Partial<CreateFormState>) => void
  protocols: string[]
  busy: boolean
  errors: { route?: string; baseURL?: string }
  onCreate: (mode: 'config' | 'test') => void
  onCancel: () => void
}

export function CreateForm({ t, form, set, protocols, busy, errors, onCreate, onCancel }: Props) {
  const protoOptions = protocols.length
    ? protocols
    : ['openai-completions', 'openai-responses', 'anthropic-messages']

  return (
    <div className="mpro-card">
      <div className="mpro-cardHead">
        <div>
          <h3 className="mpro-cardTitle">{t('createTitle')}</h3>
          <p className="mpro-hint" style={{ marginTop: 2 }}>{t('createHint')}</p>
        </div>
        <button className="mpro-btn mpro-btnSm mpro-btnGhost" onClick={onCancel}>
          {t('cancel')}
        </button>
      </div>
      <div className="mpro-cardBody">
        {/* Step 1 — 命名 */}
        <section className="mpro-step">
          <span className="mpro-stepLabel">{t('stepName')}</span>
          <div className="mpro-grid2">
            <div className="mpro-field">
              <span className="mpro-fieldLabel">{t('displayNameField')}</span>
              <input
                className="mpro-input"
                value={form.displayName}
                onChange={(e) => set({ displayName: e.target.value })}
              />
              <span className="mpro-hint">{t('displayNameHint')}</span>
            </div>
            <div className="mpro-field">
              <span className="mpro-fieldLabel">{t('routeField')}</span>
              <input
                className="mpro-input mpro-inputMono"
                value={form.route}
                placeholder={t('routePlaceholder')}
                onChange={(e) => set({ route: e.target.value })}
              />
              <span className="mpro-hint">{t('routeHint')}</span>
              {errors.route ? <span className="mpro-inlineErr">{errors.route}</span> : null}
            </div>
          </div>
        </section>

        {/* Step 2 — 连接 */}
        <section className="mpro-step">
          <span className="mpro-stepLabel">{t('stepConnect')}</span>
          <div className="mpro-grid2">
            <div className="mpro-field">
              <span className="mpro-fieldLabel">{t('apiField')}</span>
              <select
                className="mpro-input mpro-select"
                value={form.api}
                onChange={(e) => set({ api: e.target.value })}
              >
                {protoOptions.map((p) => (
                  <option key={p} value={p}>
                    {p} · {protoLabel(p, t)}
                  </option>
                ))}
              </select>
            </div>
            <div className="mpro-field">
              <span className="mpro-fieldLabel">{t('baseURLField')}</span>
              <input
                className="mpro-input mpro-inputMono"
                value={form.baseURL}
                placeholder={t('baseURLPlaceholder')}
                onChange={(e) => set({ baseURL: e.target.value })}
              />
              <span className="mpro-hint">{t('baseURLHint')}</span>
              {errors.baseURL ? <span className="mpro-inlineErr">{errors.baseURL}</span> : null}
            </div>
          </div>
        </section>

        {/* Step 3 — 凭据 */}
        <section className="mpro-step">
          <span className="mpro-stepLabel">{t('stepCreds')}</span>
          <div className="mpro-field">
            <span className="mpro-fieldLabel">{t('apiKeyField')}</span>
            <input
              className="mpro-input mpro-inputMono"
              type="password"
              value={form.apiKey}
              placeholder={t('apiKeyPlaceholder')}
              onChange={(e) => set({ apiKey: e.target.value })}
            />
            <span className="mpro-hint">{t('apiKeyHint')}</span>
          </div>
          <div className="mpro-field">
            <span className="mpro-fieldLabel">{t('apiKeyEnvField')}</span>
            <input
              className="mpro-input mpro-inputMono"
              value={form.apiKeyEnv}
              placeholder={t('apiKeyEnvPlaceholder')}
              onChange={(e) => set({ apiKeyEnv: e.target.value })}
            />
            <span className="mpro-hint">{t('apiKeyEnvHint')}</span>
          </div>
        </section>

        {/* Actions */}
        <div className="mpro-formFooter">
          <button className="mpro-btn mpro-btnWide" disabled={busy} onClick={() => onCreate('config')}>
            {t('createAndConfig')}
          </button>
          <button className="mpro-btn mpro-btnWide mpro-btnPrimary" disabled={busy} onClick={() => onCreate('test')}>
            {busy ? t('creating') : t('createAndTest')}
          </button>
        </div>
      </div>
    </div>
  )
}
