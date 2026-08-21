/** OverviewPanel — the "概览" tab. Left: editable connection fields (saved on
 * blur). Right: a readiness checklist that makes the next step obvious. */

import React from '../react'
import type { InfoState, TFunc, CallFn } from '../../shared/types'
import { fmt } from '../labels'

interface Props {
  t: TFunc
  info: InfoState
  set: (patch: Partial<InfoState>) => void
  protocols: string[]
  route: string
  call: CallFn
  hasSecret: boolean
  saveField: (field: string, value: string) => void
  modelCount: number
  headerCount: number
  onGoTest: () => void
  inlineStatus: React.ReactElement | null
}

export function OverviewPanel({
  t, info, set, protocols, route, call, hasSecret,
  saveField, modelCount, headerCount, onGoTest, inlineStatus,
}: Props) {
  const [draft, setDraft] = React.useState('')
  const [showDraft, setShowDraft] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  const [revealed, setRevealed] = React.useState('')
  const [showRevealed, setShowRevealed] = React.useState(false)
  const [msg, setMsg] = React.useState('')

  const saveKey = async () => {
    setBusy(true)
    setMsg('')
    try {
      const r = await call('set-api-key', { route, apiKey: draft })
      setRevealed('')
      setShowRevealed(false)
      setDraft('')
      setMsg(draft.trim() ? t('apiKeySaved') : t('apiKeyCleared'))
    } catch (e) {
      setMsg(t('apiKeySaveErr') + String((e as Error)?.message || e))
    } finally {
      setBusy(false)
    }
  }

  const reveal = async () => {
    if (showRevealed) { setShowRevealed(false); setRevealed(''); return }
    setBusy(true)
    setMsg('')
    try {
      const r = await call('get-provider', { route, includeSecret: true })
      if (r && typeof r.secret === 'string') { setRevealed(r.secret); setShowRevealed(true) }
      else setMsg(t('apiKeyRevealFail'))
    } catch (e) {
      setMsg(t('apiKeyRevealFail') + ' ' + String((e as Error)?.message || e))
    } finally {
      setBusy(false)
    }
  }

  const check = (done: boolean) => (
    <span className="mpro-setupDot">{done ? '✓' : ''}</span>
  )
  const row = (key: string, done: boolean, extra?: React.ReactNode) => (
    <div className={done ? 'mpro-setupItem mpro-setupDone' : 'mpro-setupItem mpro-setupTodo'}>
      {check(done)}
      <span>{extra || key}</span>
    </div>
  )

  return (
    <div className="mpro-panel">
      <div className="mpro-overviewGrid">
        {/* connection fields */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div className="mpro-grid2">
            <div className="mpro-field">
              <span className="mpro-fieldLabel">{t('displayNameField')}</span>
              <input
                className="mpro-input"
                value={info.displayName}
                onChange={(e) => set({ displayName: e.target.value })}
                onBlur={() => void saveField('displayName', info.displayName)}
              />
            </div>
            <div className="mpro-field">
              <span className="mpro-fieldLabel">{t('apiField')}</span>
              <select
                className="mpro-input mpro-select"
                value={info.api}
                onChange={(e) => { set({ api: e.target.value }); void saveField('api', e.target.value) }}
              >
                {protocols.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
          </div>
          <div className="mpro-field">
            <span className="mpro-fieldLabel">{t('baseURLField')}</span>
            <input
              className="mpro-input mpro-inputMono"
              value={info.baseURL}
              onChange={(e) => set({ baseURL: e.target.value })}
              onBlur={() => void saveField('baseURL', info.baseURL)}
            />
          </div>
          <div className="mpro-field">
            <span className="mpro-fieldLabel">{t('apiKeyEnvField')}</span>
            <input
              className="mpro-input mpro-inputMono"
              value={info.apiKeyEnv}
              placeholder={t('apiKeyEnvPlaceholder')}
              onChange={(e) => set({ apiKeyEnv: e.target.value })}
              onBlur={() => void saveField('apiKeyEnv', info.apiKeyEnv)}
            />
          </div>
          <div className="mpro-field">
            <span className="mpro-fieldLabel">
              {t('apiKeySecretField')} {hasSecret ? <span className="mpro-inlineStatusOk">{`· ${t('apiKeySet')}`}</span> : null}
            </span>
            <div className="mpro-hdrAdd">
              <input
                className="mpro-input mpro-inputMono"
                type={showDraft ? 'text' : 'password'}
                value={draft}
                placeholder={hasSecret ? t('apiKeySecretPresent') : t('apiKeyPlaceholder')}
                onChange={(e) => setDraft(e.target.value)}
                style={{ flex: 1, minWidth: 180 }}
              />
              <button className="mpro-btn mpro-btnSm" onClick={() => setShowDraft((s) => !s)}>
                {showDraft ? t('apiKeyHideDraft') : t('apiKeyShowDraft')}
              </button>
              <button className="mpro-btn mpro-btnSm" disabled={busy} onClick={() => void saveKey()}>
                {t('apiKeySave')}
              </button>
              {hasSecret && (
                <button className="mpro-btn mpro-btnSm mpro-btnGhost" disabled={busy} onClick={() => void reveal()}>
                  {showRevealed ? t('apiKeyHideStored') : t('apiKeyShowStored')}
                </button>
              )}
            </div>
            {showRevealed && revealed ? (
              <div className="mpro-reply" style={{ marginTop: 6, overflowWrap: 'break-word' }}>{revealed}</div>
            ) : null}
            {msg ? <span className="mpro-inlineStatus">{msg}</span> : null}
            <span className="mpro-hint">{t('apiKeySecretHint')}</span>
          </div>
          {inlineStatus}
        </div>

        {/* readiness checklist */}
        <div className="mpro-setupCard">
          <p className="mpro-sectionTitle">{t('setupTitle')}</p>
          {row(t('setupItemBaseURL'), !!info.baseURL)}
          {row(t('setupItemKey'), !!info.apiKeyEnv)}
          {row(fmt(t('setupItemModels'), { n: modelCount }), modelCount > 0)}
          {row(fmt(t('setupItemHeaders'), { n: headerCount }), headerCount > 0)}
          {row(t('setupItemTest'), false)}
          <button className="mpro-setupGo" onClick={onGoTest}>{t('goTest')}</button>
        </div>
      </div>
    </div>
  )
}
