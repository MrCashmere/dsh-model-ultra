/** ModelsPanel — the "模型" tab. Discover remote models, select with bulk
 * operations, then replace/merge into the provider; manage the current list. */

import React from '../react'
import type { ModelEntry, DiscoveredModel, InfoState, StatusMsg, TFunc, CallFn } from '../../shared/types'
import { fmt } from '../labels'

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
      setStatus({ kind: 'ok', text: fmt(t('statusModels'), { count: r.count }) })
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
      setStatus({ kind: 'ok', text: fmt(t('statusModels'), { count: r.count }) })
      const fresh = await call('get-provider', { route })
      setModels(fresh.models || [])
    } catch (e) { fail(e) } finally { setBusy(false) }
  }

  const selectedCurrent = (models || []).filter((m) => selectedIds[m.id])

  return (
    <div className="mpro-panel">
      <p className="mpro-hint">{t('modelsHint')}</p>

      {/* discovery bar */}
      <div className="mpro-discoverBar">
        <div className="mpro-field" style={{ flex: 1.4, minWidth: 200 }}>
          <span className="mpro-fieldLabel">{t('baseURLField')}</span>
          <input
            className="mpro-input mpro-inputMono"
            value={info.baseURL}
            placeholder={t('baseURLPlaceholder')}
            onChange={(e) => set({ baseURL: e.target.value })}
          />
        </div>
        <div className="mpro-field" style={{ flex: 1, minWidth: 150 }}>
          <span className="mpro-fieldLabel">{t('apiField')}</span>
          <select
            className="mpro-input mpro-select"
            value={info.api}
            onChange={(e) => set({ api: e.target.value })}
          >
            {protocols.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
        <div className="mpro-field" style={{ flex: 1, minWidth: 170 }}>
          <span className="mpro-fieldLabel">{t('apiKeyProbe')}</span>
          <input
            className="mpro-input mpro-inputMono"
            type="password"
            value={apiKeyProbe}
            placeholder="…"
            onChange={(e) => setApiKeyProbe(e.target.value)}
          />
        </div>
      </div>
      <div className="mpro-discoverBar" style={{ marginTop: -8 }}>
        <button className="mpro-btn mpro-btnPrimary" disabled={busy} onClick={() => void discover()}>
          {busy ? t('discovering') : t('discover')}
        </button>
        <span className="mpro-hint">{t('discoverHint')} {t('apiKeyProbeHint')}</span>
      </div>

      {/* discovered */}
      {discovered && (
        <>
          <div>
            <div className="mpro-modelBar">
              <p className="mpro-sectionTitle" style={{ margin: 0 }}>{fmt(t('discoveredTitle'), { n: discovered.length })}</p>
              <span className="mpro-right" />
              <button className="mpro-btn mpro-btnSm" onClick={selectAll}>{t('selectAll')}</button>
              <button className="mpro-btn mpro-btnSm" onClick={unselectAll}>{t('unselectAll')}</button>
              <button className="mpro-btn mpro-btnSm" onClick={invert}>{t('invert')}</button>
              <span className="mpro-chip mpro-chipSel">{selectedModels.length}/{discovered.length}</span>
            </div>
            {discovered.length === 0 ? (
              <div className="mpro-emptyState">{t('emptyDiscovered')}</div>
            ) : (
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
                        <td className="mpro-id">{m.id}</td>
                        <td>{m.name || m.id}</td>
                        <td className="mpro-dim">{m.contextWindow ? String(m.contextWindow) : '—'}</td>
                        <td className="mpro-dim">{m.maxTokens ? String(m.maxTokens) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="mpro-formFooter">
              <button className="mpro-btn mpro-btnPrimary" disabled={busy || !selectedModels.length} onClick={() => void applyModels('replace')}>
                {t('applyReplace')}
              </button>
              <button className="mpro-btn" disabled={busy || !selectedModels.length} onClick={() => void applyModels('merge')}>
                {t('applyMerge')}
              </button>
            </div>
          </div>
        </>
      )}

      {/* current explicit models */}
      <div>
        <div className="mpro-modelBar">
          <p className="mpro-sectionTitle" style={{ margin: 0 }}>{fmt(t('currentModelsTitle'), { n: (models || []).length })}</p>
          <span className="mpro-right" />
          {selectedCurrent.length > 0 && (
            <button className="mpro-btn mpro-btnSm mpro-btnDanger" disabled={busy} onClick={() => void removeSelected()}>
              {t('removeSelected')} ({selectedCurrent.length})
            </button>
          )}
        </div>
        {models && models.length ? (
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
                    <td className="mpro-id">{m.id}</td>
                    <td>{m.name || m.id}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="mpro-emptyState">{t('emptyModels')}</div>
        )}
      </div>

      {inlineStatus}
    </div>
  )
}
