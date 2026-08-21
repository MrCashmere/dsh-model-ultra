/** OverviewPanel — the "概览" tab. Left: editable connection fields (saved on
 * blur). Right: a readiness checklist that makes the next step obvious. */

import React from '../react'
import type { InfoState, TFunc } from '../../shared/types'
import { fmt } from '../labels'

interface Props {
  t: TFunc
  info: InfoState
  set: (patch: Partial<InfoState>) => void
  protocols: string[]
  route: string
  saveField: (field: string, value: string) => void
  modelCount: number
  headerCount: number
  onGoTest: () => void
  inlineStatus: React.ReactElement | null
}

export function OverviewPanel({
  t, info, set, protocols, route, saveField,
  modelCount, headerCount, onGoTest, inlineStatus,
}: Props) {
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
