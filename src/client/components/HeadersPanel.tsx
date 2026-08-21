/** HeadersPanel — the "请求头" tab. Add/remove custom headers; save persists. */

import React from '../react'
import type { HeaderPair, TFunc } from '../../shared/types'

interface Props {
  t: TFunc
  headers: HeaderPair[]
  setHeaders: React.Dispatch<React.SetStateAction<HeaderPair[]>>
  busy: boolean
  saveHeaders: () => void
  inlineStatus: React.ReactElement | null
}

export function HeadersPanel({ t, headers, setHeaders, busy, saveHeaders, inlineStatus }: Props) {
  const addHeader = () => setHeaders((h) => [...h, { name: '', value: '' }])
  const setHeader = (i: number, patch: Partial<HeaderPair>) =>
    setHeaders((h) => h.map((r, idx) => (idx === i ? { ...r, ...patch } : r)))
  const removeHeader = (i: number) => setHeaders((h) => h.filter((_, idx) => idx !== i))

  return (
    <div className="mpro-panel">
      <p className="mpro-hint">{t('headersHint')}</p>

      {headers.length > 0 ? (
        <div>
          {headers.map((h, i) => (
            <div key={i} className="mpro-hdrRow">
              <input
                className="mpro-input mpro-inputMono"
                value={h.name}
                placeholder={t('headerName')}
                onChange={(e) => setHeader(i, { name: e.target.value })}
              />
              <input
                className="mpro-input mpro-inputMono"
                value={h.value}
                placeholder={t('headerValue')}
                onChange={(e) => setHeader(i, { value: e.target.value })}
              />
              <button className="mpro-btn mpro-btnSm mpro-btnDanger" onClick={() => removeHeader(i)}>
                ×
              </button>
            </div>
          ))}
        </div>
      ) : (
        <div className="mpro-emptyState">{t('emptyHeaders')}</div>
      )}

      <div className="mpro-hdrAdd">
        <button className="mpro-btn" onClick={addHeader}>{t('addHeader')}</button>
        <button className="mpro-btn mpro-btnPrimary" disabled={busy} onClick={saveHeaders}>
          {t('saveHeaders')}
        </button>
        {inlineStatus}
      </div>
    </div>
  )
}
