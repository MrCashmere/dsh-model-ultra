/** ModelsPanel — the "模型" tab in the provider editor. */

import React from '../react'
import type { ModelEntry, DiscoveredModel, InfoState, StatusMsg, TFunc, CallFn } from '../../shared/types'

interface Props {
  t: TFunc
  call: CallFn
  route: string
  info: InfoState
  set: (patch: Partial<InfoState>) => void
  protocols: string[]
  models: ModelEntry[]
  setModels: React.Dispatch<React.SetStateAction<ModelEntry[]>>
  discovered: DiscoveredModel[] | null
  setDiscovered: React.Dispatch<React.SetStateAction<DiscoveredModel[] | null>>
  selectedIds: Record<string, boolean>
  setSelectedIds: React.Dispatch<React.SetStateAction<Record<string, boolean>>>
  apiKeyProbe: string
  setApiKeyProbe: React.Dispatch<React.SetStateAction<string>>
  busy: boolean
  setBusy: React.Dispatch<React.SetStateAction<boolean>>
  setStatus: React.Dispatch<React.SetStateAction<StatusMsg | null>>
  fail: (e: unknown) => void
  inlineStatus: React.ReactElement | null
}

export function ModelsPanel({
  t, call, route, info, set, protocols, models, setModels,
  discovered, setDiscovered, selectedIds, setSelectedIds,
  apiKeyProbe, setApiKeyProbe, busy, setBusy, setStatus, fail, inlineStatus,
}: Props) {
  const toggleSel = (id: string) =>
    setSelectedIds((s) => ({ ...s, [id]: !s[id] }))
  const selectAll = () => {
    const s: Record<string, boolean> = {}
    ;(discovered || []).forEach((m) => { s[m.id] = true })
    setSelectedIds(s)
  }
  const unselectAll = () => setSelectedIds({})
  const invert = () => {
    const s: Record<string, boolean> = {}
    ;(discovered || []).forEach((m) => { s[m.id] = !selectedIds[m.id] })
    setSelectedIds(s)
  }

  const selectedModels = (discovered || []).filter((m) => selectedIds[m.id])

  const discover = async () => {
    setBusy(true); setStatus(null); setDiscovered(null); setSelectedIds({})
    try {
      const r = await call('discover-models', { route, baseURL: info.baseURL, api: info.api, apiKey: apiKeyProbe })
      const list: DiscoveredModel[] = r.models || []
      setDiscovered(list)
      const sel: Record<string, boolean> = {}
      list.forEach((m) => { sel[m.id] = true })
      setSelectedIds(sel)
    } catch (e) { fail(e) } finally { setBusy(false) }
  }

  const applyModels = async (mode: 'replace' | 'merge') => {
    if (!selectedModels.length) return
    setBusy(true); setStatus(null)
    try {
      const r = await call('apply-models', { route, models: selectedModels, mode })
      setStatus({ kind: 'ok', text: t('statusModels').replace('{count}', String(r.count)) })
      const fresh = await call('get-provider', { route })
      setModels(fresh.models || [])
    } catch (e) { fail(e) } finally { setBusy(false) }
  }

  const removeSelected = async () => {
    const marked = (models || []).filter((m) => selectedIds[m.id])
    if (!marked.length) return
    setBusy(true); setStatus(null)
    try {
      const r = await call('apply-models', { route, models: marked, mode: 'remove' })
      setStatus({ kind: 'ok', text: t('statusModels').replace('{count}', String(r.count)) })
      const fresh = await call('get-provider', { route })
      setModels(fresh.models || [])
    } catch (e) { fail(e) } finally { setBusy(false) }
  }

  const children: React.ReactElement[] = [
    <p className="mpro-hint">{t('modelsHint')}</p>,
    <div className="mpro-grid2">
      <div className="mpro-field">
        <span className="mpro-fieldLabel">{t('baseURLField')}</span>
        <input
          className="mpro-input"
          value={info.baseURL}
          placeholder={t('baseURLField')}
          onChange={(e) => set({ baseURL: e.target.value })}
        />
      </div>
      <div className="mpro-field">
        <span className="mpro-fieldLabel">{t('apiField')}</span>
        <select
          className="mpro-input mpro-select"
          value={info.api}
          onChange={(e) => set({ api: e.target.value })}
        >
          {protocols.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
      </div>
    </div>,
    <div className="mpro-field">
      <span className="mpro-fieldLabel">{t('apiKeyProbe')}</span>
      <input
        className="mpro-input"
        type="password"
        value={apiKeyProbe}
        placeholder={t('apiKeyProbe')}
        onChange={(e) => setApiKeyProbe(e.target.value)}
      />
    </div>,
    <button className="mpro-btn mpro-btnPrimary" disabled={busy} onClick={discover}>
      {busy ? t('discovering') : t('discover')}
    </button>,
    <p className="mpro-hint">{t('discoverHint')}</p>,
  ]

  if (discovered) {
    children.push(
      <div className="mpro-modelBar">
        <button className="mpro-btn mpro-btnSm" onClick={selectAll}>{t('selectAll')}</button>
        <button className="mpro-btn mpro-btnSm" onClick={unselectAll}>{t('unselectAll')}</button>
        <button className="mpro-btn mpro-btnSm" onClick={invert}>{t('invert')}</button>
        <span className="mpro-chip">{selectedModels.length}/{discovered.length}</span>
      </div>,
      <div className="mpro-tblWrap">
        <table className="mpro-tbl">
          <thead>
            <tr>
              <th className="mpro-tblCk"></th>
              <th>{t('idCol')}</th>
              <th>{t('nameCol')}</th>
              <th>{t('ctxCol')}</th>
              <th>{t('outCol')}</th>
            </tr>
          </thead>
          <tbody>
            {discovered.map((m) => (
              <tr key={m.id}>
                <td className="mpro-tblCk">
                  <input type="checkbox" checked={!!selectedIds[m.id]} onChange={() => toggleSel(m.id)} />
                </td>
                <td>{m.id}</td>
                <td>{m.name || m.id}</td>
                <td>{m.contextWindow ? String(m.contextWindow) : '—'}</td>
                <td>{m.maxTokens ? String(m.maxTokens) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>,
      <div style={{ display: 'flex', gap: '8px' }}>
        <button className="mpro-btn mpro-btnPrimary" disabled={busy || !selectedModels.length} onClick={() => void applyModels('replace')}>
          {t('applyReplace')}
        </button>
        <button className="mpro-btn" disabled={busy || !selectedModels.length} onClick={() => void applyModels('merge')}>
          {t('applyMerge')}
        </button>
      </div>,
    )
  }

  children.push(
    <div style={{ marginTop: '8px', display: 'flex', alignItems: 'center', gap: '8px' }}>
      <span className="mpro-fieldLabel" style={{ margin: '0' }}>
        {t('modelsTitle')} ({(models || []).length})
      </span>
      {models && models.some((m) => selectedIds[m.id]) && (
        <button className="mpro-btn mpro-btnSm mpro-btnDanger" disabled={busy} onClick={removeSelected}>
          {t('removeSelected')}
        </button>
      )}
    </div>,
  )

  if (models && models.length) {
    children.push(
      <div className="mpro-tblWrap">
        <table className="mpro-tbl">
          <thead>
            <tr>
              <th className="mpro-tblCk"></th>
              <th>{t('idCol')}</th>
              <th>{t('nameCol')}</th>
            </tr>
          </thead>
          <tbody>
            {models.map((m) => (
              <tr key={m.id}>
                <td className="mpro-tblCk">
                  <input type="checkbox" checked={!!selectedIds[m.id]} onChange={() => toggleSel(m.id)} />
                </td>
                <td>{m.id}</td>
                <td>{m.name || m.id}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>,
    )
  }

  children.push(inlineStatus!)

  return <div className="mpro-cardBody">{children}</div>
}
