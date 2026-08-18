/** InfoPanel — the "基本信息" tab in the provider editor. */

import React from '../react'
import type { InfoState, StatusMsg, TFunc, CallFn } from '../../shared/types'

interface Props {
  t: TFunc
  info: InfoState
  set: (patch: Partial<InfoState>) => void
  protocols: string[]
  route: string
  saveField: (field: string, value: string) => void
  inlineStatus: React.ReactElement | null
}

export function InfoPanel({ t, info, set, protocols, route, saveField, inlineStatus }: Props) {
  return (
    <div className="mpro-cardBody">
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
          className="mpro-input"
          value={info.baseURL}
          onChange={(e) => set({ baseURL: e.target.value })}
          onBlur={() => void saveField('baseURL', info.baseURL)}
        />
      </div>
      <div className="mpro-field">
        <span className="mpro-fieldLabel">{t('apiKeyEnvField')}</span>
        <input
          className="mpro-input"
          value={info.apiKeyEnv}
          onChange={(e) => set({ apiKeyEnv: e.target.value })}
          onBlur={() => void saveField('apiKeyEnv', info.apiKeyEnv)}
        />
      </div>
      {inlineStatus}
    </div>
  )
}
