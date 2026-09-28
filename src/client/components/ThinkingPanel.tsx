/**
 * ThinkingPanel — the "思考强度" tab.
 *
 * Two layers, mirroring where llm-pi-ai stores them:
 *   - route defaults: `reasoning` (default level), `thinkingBudgets` (the four
 *     token budgets, all-or-nothing) and the thinking `compat` switches;
 *   - per model: `reasoningEfforts` — which levels the model offers and the wire
 *     spelling each level sends. Every level row keeps a free-text field (manual
 *     entry) next to the preset chips, so a gateway vocabulary the presets do not
 *     list is still one keystroke away.
 *
 * A model on a catalog route has no `models` entry to edit; the host then writes
 * `modelOverrides[id]`, which is why each row shows where its value lives.
 */

import React from '../react'
import type { ProviderData, StatusMsg, TFunc, CallFn } from '../../shared/types'
import {
  EFFORT_PRESETS,
  EFFORT_PRESETS_ALL,
  THINKING_BUDGET_KEYS,
  THINKING_FORMATS,
  THINKING_LEVELS,
  THINKING_TOKEN_BUDGET_FIELDS,
  type ThinkingBudgets,
  type ThinkingFormat,
  type ThinkingLevel,
} from '../../shared/thinking'

interface Props {
  t: TFunc
  call: CallFn
  data: ProviderData
  busy: boolean
  setBusy: React.Dispatch<React.SetStateAction<boolean>>
  setStatus: React.Dispatch<React.SetStateAction<StatusMsg | null>>
  fail: (e: unknown) => void
  inlineStatus: React.ReactElement | null
}

/** The tri-state the compat booleans expose: inherit / on / off. */
type Tri = '' | 'on' | 'off'

interface ModelRow {
  id: string
  name: string
  /** Where this model's thinking config will be written. */
  storage: 'models' | 'modelOverrides' | 'catalog'
  /** `false` = non-reasoning, undefined = inherit, else level→spelling. */
  efforts: Partial<Record<ThinkingLevel, string | null>> | false | undefined
}

const toTri = (value: unknown): Tri => (value === true ? 'on' : value === false ? 'off' : '')

/** Draft state of one model's effort table: level → { enabled, spelling }. */
interface EffortDraft {
  mode: 'inherit' | 'none' | 'custom'
  levels: Record<ThinkingLevel, { on: boolean; text: string }>
}

function draftOf(efforts: ModelRow['efforts']): EffortDraft {
  const levels = {} as EffortDraft['levels']
  for (const level of THINKING_LEVELS) levels[level] = { on: false, text: '' }
  if (efforts === false) return { mode: 'none', levels }
  if (efforts === undefined) return { mode: 'inherit', levels }
  for (const [level, spelling] of Object.entries(efforts)) {
    if (!(THINKING_LEVELS as readonly string[]).includes(level)) continue
    levels[level as ThinkingLevel] = { on: true, text: spelling === null ? '' : String(spelling) }
  }
  return { mode: 'custom', levels }
}

/** Draft → the `reasoningEfforts` patch the host normalizes. */
function patchOf(draft: EffortDraft): Record<string, string | null> | false | null {
  if (draft.mode === 'inherit') return null
  if (draft.mode === 'none') return false
  const out: Record<string, string | null> = {}
  for (const level of THINKING_LEVELS) {
    const row = draft.levels[level]
    if (!row.on) continue
    const text = row.text.trim()
    out[level] = text === '' ? null : text
  }
  return out
}

export function ThinkingPanel({ t, call, data, busy, setBusy, setStatus, fail, inlineStatus }: Props) {
  const [reasoning, setReasoning] = React.useState<string>(
    typeof data.reasoning === 'string' ? data.reasoning : '',
  )
  const [budgetsOn, setBudgetsOn] = React.useState(!!data.thinkingBudgets)
  const [budgets, setBudgets] = React.useState<Record<string, string>>(() => {
    const src = (data.thinkingBudgets ?? {}) as Record<string, unknown>
    const out: Record<string, string> = {}
    for (const key of THINKING_BUDGET_KEYS) out[key] = src[key] === undefined ? '' : String(src[key])
    return out
  })
  const compat = (data.compat ?? {}) as Record<string, unknown>
  const [format, setFormat] = React.useState<string>(typeof compat.thinkingFormat === 'string' ? compat.thinkingFormat : '')
  const [budgetField, setBudgetField] = React.useState<string>(
    typeof compat.thinkingTokenBudgetField === 'string' ? compat.thinkingTokenBudgetField : '',
  )
  const [supportsEffort, setSupportsEffort] = React.useState<Tri>(toTri(compat.supportsReasoningEffort))
  const [supportsBudget, setSupportsBudget] = React.useState<Tri>(toTri(compat.supportsThinkingTokenBudget))
  const [asText, setAsText] = React.useState<Tri>(toTri(compat.requiresThinkingAsText))
  const [adaptive, setAdaptive] = React.useState<Tri>(toTri(compat.forceAdaptiveThinking))

  // Every model this route can serve: explicit entries first (they are the ones
  // with a `models` home), then catalog ids, then existing overrides.
  const rows: ModelRow[] = React.useMemo(() => {
    const seen = new Set<string>()
    const out: ModelRow[] = []
    for (const m of data.models || []) {
      if (!m || typeof m.id !== 'string' || seen.has(m.id)) continue
      seen.add(m.id)
      out.push({
        id: m.id,
        name: typeof m.name === 'string' && m.name ? m.name : m.id,
        storage: 'models',
        efforts: (m as Record<string, unknown>).reasoningEfforts as ModelRow['efforts'],
      })
    }
    const overrides = (data.modelOverrides ?? {}) as Record<string, Record<string, unknown>>
    for (const id of Object.keys(overrides)) {
      if (seen.has(id)) continue
      seen.add(id)
      out.push({ id, name: id, storage: 'modelOverrides', efforts: overrides[id]?.reasoningEfforts as ModelRow['efforts'] })
    }
    for (const id of data.availableModels || []) {
      if (typeof id !== 'string' || id === '' || seen.has(id)) continue
      seen.add(id)
      out.push({ id, name: id, storage: 'catalog', efforts: undefined })
    }
    return out
  }, [data.models, data.modelOverrides, data.availableModels])

  const [drafts, setDrafts] = React.useState<Record<string, EffortDraft>>({})
  const [openModel, setOpenModel] = React.useState<string | null>(null)

  const draftFor = (row: ModelRow): EffortDraft => drafts[row.id] ?? draftOf(row.efforts)
  const setDraft = (id: string, next: EffortDraft) => setDrafts((d) => ({ ...d, [id]: next }))

  const summaryOf = (row: ModelRow): string => {
    const draft = drafts[row.id] ?? draftOf(row.efforts)
    if (draft.mode === 'inherit') return t('thinkingModeInherit')
    if (draft.mode === 'none') return t('thinkingModeNone')
    const parts: string[] = []
    for (const level of THINKING_LEVELS) {
      const r = draft.levels[level]
      if (!r.on) continue
      const text = r.text.trim()
      if (text === '') parts.push(`${level}→${level === 'off' ? t('thinkingValueless') : t('thinkingNeedsValue')}`)
      else parts.push(`${level}→${text}`)
    }
    return parts.length > 0 ? parts.join(' · ') : t('thinkingModeNone')
  }

  const run = async (fn: () => Promise<void>) => {
    setBusy(true); setStatus(null)
    try { await fn() } catch (e) { fail(e) } finally { setBusy(false) }
  }

  const saveRoute = () => run(async () => {
    const patch: Record<string, unknown> = {
      reasoning: reasoning === '' ? null : reasoning,
      compat: {
        thinkingFormat: format === '' ? null : format,
        thinkingTokenBudgetField: budgetField === '' ? null : budgetField,
        supportsReasoningEffort: supportsEffort === '' ? null : supportsEffort === 'on',
        supportsThinkingTokenBudget: supportsBudget === '' ? null : supportsBudget === 'on',
        requiresThinkingAsText: asText === '' ? null : asText === 'on',
        forceAdaptiveThinking: adaptive === '' ? null : adaptive === 'on',
      },
    }
    if (!budgetsOn) patch.thinkingBudgets = null
    else {
      const next = {} as ThinkingBudgets
      for (const key of THINKING_BUDGET_KEYS) {
        const n = Number(budgets[key])
        if (!Number.isFinite(n) || n < 1) throw new Error(`${t('thinkingBudgetInvalid')}: ${key}`)
        next[key] = Math.floor(n)
      }
      patch.thinkingBudgets = next
    }
    const r = await call('set-thinking', { route: data.route, patch })
    if (r && r.ok === false) throw new Error(r.error || t('callFailed'))
    setStatus({ kind: 'ok', text: t('thinkingSaved') })
  })

  const applyPreset = (row: ModelRow, presetId: string) => {
    const preset = EFFORT_PRESETS_ALL.find((p) => p.id === presetId)
    if (!preset) return
    const base = draftFor(row)
    if (preset.id === 'inherit' || preset.efforts === null) { setDraft(row.id, { ...base, mode: 'inherit' }); return }
    if (preset.efforts === false) { setDraft(row.id, { ...base, mode: 'none' }); return }
    const levels = { ...base.levels }
    for (const level of THINKING_LEVELS) levels[level] = { on: false, text: '' }
    for (const [level, spelling] of Object.entries(preset.efforts)) {
      if (!(THINKING_LEVELS as readonly string[]).includes(level)) continue
      levels[level as ThinkingLevel] = { on: true, text: spelling === null ? '' : String(spelling) }
    }
    setDraft(row.id, { mode: 'custom', levels })
  }

  const saveModel = (row: ModelRow) => run(async () => {
    const draft = draftFor(row)
    const r = await call('set-thinking', {
      route: data.route,
      modelId: row.id,
      patch: { reasoningEfforts: patchOf(draft) },
    })
    if (r && r.ok === false) throw new Error(r.error || t('callFailed'))
    setStatus({ kind: 'ok', text: `${t('thinkingSaved')} · ${row.id}` })
    setOpenModel(null)
  })

  const triSelect = (value: Tri, onChange: (v: Tri) => void) => (
    <select className="mpro-select" value={value} onChange={(e) => onChange(e.target.value as Tri)}>
      <option value="">{t('thinkingInherit')}</option>
      <option value="on">{t('thinkingBoolOn')}</option>
      <option value="off">{t('thinkingBoolOff')}</option>
    </select>
  )

  return (
    <div className="mpro-panel">
      <p className="mpro-hint">{t('thinkingIntro')}</p>

      <h3 className="mpro-subTitle">{t('thinkingRouteTitle')}</h3>
      <div className="mpro-grid2">
        <label className="mpro-field">
          <span className="mpro-label">{t('thinkingDefaultLevel')}</span>
          <select className="mpro-select" value={reasoning} onChange={(e) => setReasoning(e.target.value)}>
            <option value="">{t('thinkingInherit')}</option>
            {THINKING_LEVELS.map((level) => <option key={level} value={level}>{level}</option>)}
          </select>
        </label>
        <label className="mpro-field">
          <span className="mpro-label">{t('thinkingFormat')}</span>
          <select className="mpro-select" value={format} onChange={(e) => setFormat(e.target.value)}>
            <option value="">{t('thinkingInherit')}</option>
            {THINKING_FORMATS.map((f) => <option key={f} value={f}>{f}</option>)}
          </select>
        </label>
        <label className="mpro-field">
          <span className="mpro-label">{t('thinkingBudgetField')}</span>
          <select className="mpro-select" value={budgetField} onChange={(e) => setBudgetField(e.target.value)}>
            <option value="">{t('thinkingInherit')}</option>
            {THINKING_TOKEN_BUDGET_FIELDS.map((f) => <option key={f} value={f}>{f}</option>)}
          </select>
        </label>
        <label className="mpro-field">
          <span className="mpro-label">{t('thinkingSupportsEffort')}</span>
          {triSelect(supportsEffort, setSupportsEffort)}
        </label>
        <label className="mpro-field">
          <span className="mpro-label">{t('thinkingSupportsBudget')}</span>
          {triSelect(supportsBudget, setSupportsBudget)}
        </label>
        <label className="mpro-field">
          <span className="mpro-label">{t('thinkingAsText')}</span>
          {triSelect(asText, setAsText)}
        </label>
        <label className="mpro-field">
          <span className="mpro-label">{t('thinkingAdaptive')}</span>
          {triSelect(adaptive, setAdaptive)}
        </label>
      </div>

      <div className="mpro-hdrRow" style={{ marginTop: 10 }}>
        <label className="mpro-check">
          <input type="checkbox" checked={budgetsOn} onChange={(e) => setBudgetsOn(e.target.checked)} />
          <span>{t('thinkingBudgets')}</span>
        </label>
        {THINKING_BUDGET_KEYS.map((key) => (
          <input
            key={key}
            className="mpro-input mpro-inputNum"
            placeholder={key}
            disabled={!budgetsOn}
            value={budgets[key]}
            onChange={(e) => setBudgets((b) => ({ ...b, [key]: e.target.value }))}
          />
        ))}
      </div>
      <p className="mpro-hint">{t('thinkingBudgetHint')}</p>
      <div className="mpro-hdrAdd">
        <button className="mpro-btn mpro-btnPrimary" disabled={busy} onClick={() => void saveRoute()}>{t('thinkingSaveRoute')}</button>
        {inlineStatus}
      </div>

      <h3 className="mpro-subTitle" style={{ marginTop: 18 }}>{t('thinkingModelTitle')}</h3>
      <p className="mpro-hint">{t('thinkingModelHint')}</p>
      {rows.length === 0 ? (
        <div className="mpro-emptyState">{t('thinkingNoModels')}</div>
      ) : (
        <div className="mpro-thList">
          {rows.map((row) => {
            const draft = draftFor(row)
            const open = openModel === row.id
            return (
              <div key={row.id} className="mpro-thCard">
                <div className="mpro-thHead">
                  <button className="mpro-thToggle" onClick={() => setOpenModel(open ? null : row.id)} aria-expanded={open}>
                    {open ? '▾' : '▸'} <span className="mpro-thName">{row.name}</span>
                    <span className="mpro-thId">{row.id}</span>
                  </button>
                  <span className="mpro-thSummary">{summaryOf(row)}</span>
                  <span className="mpro-pill">{row.storage === 'models' ? t('thinkingStoreModels') : t('thinkingStoreOverrides')}</span>
                </div>
                {open && (
                  <div className="mpro-thBody">
                    <div className="mpro-tabs">
                      {(['inherit', 'none', 'custom'] as const).map((mode) => (
                        <button
                          key={mode}
                          className={draft.mode === mode ? 'mpro-tab mpro-tabActive' : 'mpro-tab'}
                          onClick={() => setDraft(row.id, { ...draft, mode })}
                        >
                          {mode === 'inherit' ? t('thinkingModeInherit') : mode === 'none' ? t('thinkingModeNone') : t('thinkingModeCustom')}
                        </button>
                      ))}
                    </div>
                    {draft.mode === 'custom' && (
                      <>
                        <div className="mpro-thPresets">
                          <span className="mpro-label">{t('thinkingPreset')}</span>
                          {EFFORT_PRESETS_ALL.filter((p) => p.id !== 'inherit').map((p) => (
                            <button key={p.id} className="mpro-chip" onClick={() => applyPreset(row, p.id)}>
                              {t(`thinkingPreset_${p.id}`)}
                            </button>
                          ))}
                        </div>
                        <table className="mpro-thTable">
                          <thead>
                            <tr>
                              <th>{t('thinkingLevel')}</th>
                              <th>{t('thinkingSpelling')}</th>
                              <th>{t('thinkingPresets')}</th>
                            </tr>
                          </thead>
                          <tbody>
                            {THINKING_LEVELS.map((level) => {
                              const cell = draft.levels[level]
                              return (
                                <tr key={level}>
                                  <td>
                                    <label className="mpro-check">
                                      <input
                                        type="checkbox"
                                        checked={cell.on}
                                        onChange={(e) => setDraft(row.id, {
                                          ...draft,
                                          levels: {
                                            ...draft.levels,
                                            // A thinking level needs a wire value, so enabling one
                                            // seeds it with its own name (llm-pi-ai refuses an
                                            // empty spelling for anything but `off`).
                                            [level]: { ...cell, on: e.target.checked, text: e.target.checked ? (cell.text || (level === 'off' ? '' : level)) : cell.text },
                                          },
                                        })}
                                      />
                                      <span>{level}</span>
                                    </label>
                                  </td>
                                  <td>
                                    <input
                                      className="mpro-input mpro-inputMono"
                                      disabled={!cell.on}
                                      value={cell.text}
                                      placeholder={level === 'off' ? t('thinkingValueless') : t('thinkingSpellingRequired')}
                                      onChange={(e) => setDraft(row.id, {
                                        ...draft,
                                        levels: { ...draft.levels, [level]: { ...cell, text: e.target.value } },
                                      })}
                                    />
                                  </td>
                                  <td>
                                    {EFFORT_PRESETS[level].map((preset) => (
                                      <button
                                        key={preset}
                                        className="mpro-chip"
                                        disabled={!cell.on}
                                        onClick={() => setDraft(row.id, {
                                          ...draft,
                                          levels: { ...draft.levels, [level]: { ...cell, text: preset } },
                                        })}
                                      >
                                        {preset}
                                      </button>
                                    ))}
                                  </td>
                                </tr>
                              )
                            })}
                          </tbody>
                        </table>
                      </>
                    )}
                    <div className="mpro-hdrAdd">
                      <button className="mpro-btn mpro-btnPrimary" disabled={busy} onClick={() => void saveModel(row)}>
                        {t('thinkingSaveModel')}
                      </button>
                      <button className="mpro-btn" disabled={busy} onClick={() => { setDrafts((d) => { const n = { ...d }; delete n[row.id]; return n }); setOpenModel(null) }}>
                        {t('cancel')}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

export type { ThinkingFormat }
