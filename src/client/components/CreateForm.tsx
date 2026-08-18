/** CreateForm — the new-provider inline form shown in the list view. */

import React from '../react'
import type { CreateFormState, TFunc } from '../../shared/types'

interface Props {
  t: TFunc
  form: CreateFormState
  set: (patch: Partial<CreateFormState>) => void
  protocols: string[]
  busy: boolean
  onCreate: () => void
  onCancel: () => void
}

export function CreateForm({ t, form, set, protocols, busy, onCreate, onCancel }: Props) {
  return (
    <div className="mpro-card">
      <div className="mpro-cardHead">
        <span className="mpro-cardTitle">{t('newProvider')}</span>
        <button className="mpro-btn mpro-btnSm" onClick={onCancel}>
          {t('cancel')}
        </button>
      </div>
      <div className="mpro-cardBody">
        <div className="mpro-grid2">
          <div className="mpro-field">
            <span className="mpro-fieldLabel">{t('routeField')}</span>
            <input
              className="mpro-input"
              value={form.route}
              placeholder={t('routePlaceholder')}
              onChange={(e) => set({ route: e.target.value })}
            />
          </div>
          <div className="mpro-field">
            <span className="mpro-fieldLabel">{t('displayNameField')}</span>
            <input
              className="mpro-input"
              value={form.displayName}
              onChange={(e) => set({ displayName: e.target.value })}
            />
          </div>
          <div className="mpro-field">
            <span className="mpro-fieldLabel">{t('apiField')}</span>
            <select
              className="mpro-input mpro-select"
              value={form.api}
              onChange={(e) => set({ api: e.target.value })}
            >
              {(protocols.length ? protocols : ['openai-completions', 'openai-responses', 'anthropic-messages']).map(
                (p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ),
              )}
            </select>
          </div>
          <div className="mpro-field">
            <span className="mpro-fieldLabel">{t('baseURLField')}</span>
            <input
              className="mpro-input"
              value={form.baseURL}
              placeholder="https://api.example.com/v1"
              onChange={(e) => set({ baseURL: e.target.value })}
            />
          </div>
        </div>
        <div className="mpro-field">
          <span className="mpro-fieldLabel">{t('apiKeyEnvField')}</span>
          <input
            className="mpro-input"
            value={form.apiKeyEnv}
            onChange={(e) => set({ apiKeyEnv: e.target.value })}
          />
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button className="mpro-btn mpro-btnPrimary" disabled={busy} onClick={onCreate}>
            {busy ? t('creating') : t('create')}
          </button>
        </div>
      </div>
    </div>
  )
}
