/** ProviderCard — a provider row in the list view. The colored left rail
 * encodes lifecycle state; name leads, then mono code + config chips; actions
 * depend on state. */

import React from '../react'
import type { ProviderListItem, TFunc } from '../../shared/types'
import { fmt, protoLabel, hostOf } from '../labels'

interface Props {
  p: ProviderListItem
  t: TFunc
  busy: boolean
  writable: boolean
  onEdit: (route: string) => void
  onTest: (route: string) => void
  onToggle: (route: string, enable: boolean) => void
  onDelete: (route: string) => void
}

export function ProviderCard({ p, t, busy, writable, onEdit, onTest, onToggle, onDelete }: Props) {
  const disabled = p.disabled
  const pill = disabled ? (
    <span className="mpro-pill mpro-pillOff">{t('stateDisabled')}</span>
  ) : (
    <span className="mpro-pill mpro-pillActive">{t('stateActive')}</span>
  )

  const host = p.baseURL ? hostOf(p.baseURL) : ''
  const keyChip = p.apiKeyEnv ? (
    <span className="mpro-chip mpro-chipGood">{t('apiKeySet')}</span>
  ) : (
    <span className="mpro-chip mpro-chipMiss">{t('apiKeyUnset')}</span>
  )

  return (
    <div className={disabled ? 'mpro-pc mpro-pcOff' : 'mpro-pc'}>
      <div className="mpro-pcMain">
        <div className="mpro-pcNameRow">
          <span className="mpro-pcName">{p.displayName || p.route}</span>
          <span className="mpro-pcRoute">{p.route}</span>
          {pill}
        </div>
        <div className="mpro-pcChips">
          <span className="mpro-chip">{protoLabel(p.api, t)}</span>
          {host ? <span className="mpro-chip mpro-chipMono">{host}</span> : <span className="mpro-chip mpro-chipMiss">{t('noBaseURL')}</span>}
          {p.modelCount > 0 ? (
            <span className="mpro-chip">{fmt(t('modelsChip'), { n: p.modelCount })}</span>
          ) : (
            <span className="mpro-chip mpro-chipMiss">{t('noModels')}</span>
          )}
          {p.headerCount > 0 ? (
            <span className="mpro-chip">{fmt(t('headersChip'), { n: p.headerCount })}</span>
          ) : null}
          {keyChip}
        </div>
      </div>
      <div className="mpro-pcActions">
        <button className="mpro-btn mpro-btnSm" onClick={() => onEdit(p.route)}>{t('edit')}</button>
        {!disabled && (
          <button className="mpro-btn mpro-btnSm mpro-btnPrimary" disabled={busy} onClick={() => onTest(p.route)}>
            {t('test')}
          </button>
        )}
        {writable && (
          <button
            className="mpro-btn mpro-btnSm"
            disabled={busy}
            onClick={() => onToggle(p.route, disabled)}
          >
            {disabled ? t('enable') : t('disable')}
          </button>
        )}
        {writable && (
          <button
            className="mpro-btn mpro-btnSm mpro-btnDanger"
            disabled={busy}
            onClick={() => onDelete(p.route)}
          >
            {t('delete')}
          </button>
        )}
      </div>
    </div>
  )
}
