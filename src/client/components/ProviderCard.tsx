/** ProviderCard — a single provider row in the list view. */

import React from '../react'
import type { ProviderListItem, TFunc } from '../../shared/types'

interface Props {
  p: ProviderListItem
  t: TFunc
  busy: boolean
  writable: boolean
  onEdit: (route: string) => void
  onToggle: (route: string, enable: boolean) => void
  onDelete: (route: string) => void
}

export function ProviderCard({ p, t, busy, writable, onEdit, onToggle, onDelete }: Props) {
  let dotClass = 'mpro-pcDot'
  let tag: React.ReactElement | null = null

  if (p.disabled) {
    dotClass = 'mpro-pcDotOff'
    tag = <span className="mpro-tag mpro-tagOff">{t('disabled')}</span>
  } else if (p.usesCatalog) {
    dotClass = 'mpro-pcDotCat'
    tag = <span className="mpro-tag mpro-tagCat">{t('usesCatalog')}</span>
  } else {
    tag = <span className="mpro-tag mpro-tagExp">{t('explicit')}</span>
  }

  return (
    <div key={p.route} className={p.disabled ? 'mpro-pc mpro-pcDisabled' : 'mpro-pc'}>
      <div className={dotClass} />
      <div className="mpro-pcInfo">
        <div className="mpro-pcName">
          {p.route}
          {tag}
        </div>
        <div className="mpro-pcMeta">
          <span>{p.api || '—'}</span>
          <span>{p.baseURL ? p.baseURL.replace(/^https?:\/\//, '').replace(/\/$/, '') : '—'}</span>
          <span>{p.modelCount} models</span>
          {p.headerCount ? <span>{p.headerCount} headers</span> : null}
        </div>
      </div>
      <div className="mpro-pcActions">
        <button className="mpro-btn mpro-btnSm" onClick={() => onEdit(p.route)}>
          {t('edit')}
        </button>
        {writable && (
          <button
            className="mpro-btn mpro-btnSm"
            disabled={busy}
            onClick={() => onToggle(p.route, !!p.disabled)}
          >
            {p.disabled ? t('enable') : t('disable')}
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
