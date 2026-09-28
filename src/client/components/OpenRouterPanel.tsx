/**
 * OpenRouterPanel — the "OpenRouter" tab.
 *
 * Ports the configuration surface of `dsh-openrouter-providers` v1.3.0 into this
 * plugin's settings page: the provider allow-list / preference order, the
 * quantization limit, a master switch, plus the app-attribution headers and the
 * request-shaping status readout. Edits are staged locally and written by 保存
 * (the reference bundle view discards staged edits when you leave the page).
 */

import React from '../react'
import type { StatusMsg, TFunc, CallFn } from '../../shared/types'
import {
  DEFAULT_OPENROUTER_STATE,
  OPENROUTER_DEFAULT_HOSTS,
  QUANT_LEVELS,
  QUANT_OFF,
  openRouterActive,
  parseProviderList,
  type OpenRouterState,
} from '../../shared/openrouter'

interface Props {
  t: TFunc
  call: CallFn
  busy: boolean
  setBusy: React.Dispatch<React.SetStateAction<boolean>>
  setStatus: React.Dispatch<React.SetStateAction<StatusMsg | null>>
  fail: (e: unknown) => void
  inlineStatus: React.ReactElement | null
}

interface ShaperStatus {
  installed?: boolean
  reason?: string
  calls?: number
  shaped?: number
  attributed?: number
  lastError?: string
}

interface SelfTest {
  changed?: boolean
  params?: Record<string, unknown> | null
  after?: string
}

const sameList = (a: string[], b: string[]) => a.length === b.length && a.every((v, i) => v === b[i])

export function OpenRouterPanel({ t, call, busy, setBusy, setStatus, fail, inlineStatus }: Props) {
  const [loaded, setLoaded] = React.useState(false)
  const [state, setState] = React.useState<OpenRouterState>(DEFAULT_OPENROUTER_STATE)
  const [saved, setSaved] = React.useState<OpenRouterState>(DEFAULT_OPENROUTER_STATE)
  const [text, setText] = React.useState('')
  const [savedText, setSavedText] = React.useState('')
  const [hostsText, setHostsText] = React.useState(OPENROUTER_DEFAULT_HOSTS.join(', '))
  const [savedHostsText, setSavedHostsText] = React.useState(OPENROUTER_DEFAULT_HOSTS.join(', '))
  const [shaper, setShaper] = React.useState<ShaperStatus>({})
  const [selfTest, setSelfTest] = React.useState<SelfTest>({})
  const [importNote, setImportNote] = React.useState('')
  const [saving, setSaving] = React.useState(false)
  const probed = React.useRef(false)

  const adopt = (next: OpenRouterState, live?: ShaperStatus, probe?: SelfTest) => {
    setState(next); setSaved(next)
    setText(next.providers.join('\n')); setSavedText(next.providers.join('\n'))
    const hosts = (next.hosts.length > 0 ? next.hosts : [...OPENROUTER_DEFAULT_HOSTS]).join(', ')
    setHostsText(hosts); setSavedHostsText(hosts)
    if (live) setShaper(live)
    if (probe) setSelfTest(probe)
  }

  const load = React.useCallback(async () => {
    const r = await call('get-openrouter', {})
    if (r && r.ok === false) throw new Error(r.error || t('callFailed'))
    adopt(r.state as OpenRouterState, r.shaper as ShaperStatus, r.selfTest as SelfTest)
  }, [call, t])

  React.useEffect(() => {
    if (probed.current) return
    probed.current = true
    setBusy(true)
    load().catch(fail).finally(() => { setBusy(false); setLoaded(true) })
  }, [load, fail, setBusy])

  const providers = parseProviderList(text)
  const hosts = parseProviderList(hostsText).map((h) => h.trim().toLowerCase())
  const dirty =
    state.enabled !== saved.enabled
    || state.mode !== saved.mode
    || state.quantization !== saved.quantization
    || state.attribution !== saved.attribution
    || state.attributionTitle !== saved.attributionTitle
    || !sameList(providers, saved.providers)
    || !sameList(hosts, saved.hosts)

  const save = async () => {
    setSaving(true); setStatus(null)
    try {
      const r = await call('set-openrouter', {
        patch: {
          enabled: state.enabled,
          mode: state.mode,
          providers,
          quantization: state.quantization,
          hosts: hosts.length > 0 ? hosts : [...OPENROUTER_DEFAULT_HOSTS],
          attribution: state.attribution,
          attributionTitle: state.attributionTitle,
        },
      })
      if (r && r.ok === false) throw new Error(r.error || t('callFailed'))
      adopt(r.state as OpenRouterState, r.shaper as ShaperStatus, r.selfTest as SelfTest)
      const list = (r.state as OpenRouterState).providers
      setStatus({ kind: 'ok', text: list.length > 0 ? `${t('orSaved')}: ${list.join(', ')}` : t('orSavedEmpty') })
    } catch (e) { fail(e) } finally { setSaving(false) }
  }

  const discard = () => {
    setState(saved)
    setText(savedText)
    setHostsText(savedHostsText)
    setStatus(null)
  }

  const runImport = async () => {
    setBusy(true); setStatus(null); setImportNote('')
    try {
      const r = await call('import-openrouter', {})
      const sources = Array.isArray(r?.sources) ? r.sources : []
      const detail = sources
        .map((s: { path?: string; status?: string; detail?: string }) => `${s.status}${s.detail ? ` (${s.detail})` : ''}`)
        .join('; ')
      if (r && r.ok === false) {
        setImportNote(`${r.error || t('orImportFailed')}${detail ? ` — ${detail}` : ''}`)
        return
      }
      adopt(r.state as OpenRouterState, r.shaper as ShaperStatus, r.selfTest as SelfTest)
      setImportNote(`${t('orImported')}${detail ? ` — ${detail}` : ''}`)
      setStatus({ kind: 'ok', text: t('orImported') })
    } catch (e) { fail(e) } finally { setBusy(false) }
  }

  const runSelfTest = async () => {
    setBusy(true); setStatus(null)
    try {
      const r = await call('openrouter-selftest', {})
      if (r && r.ok === false) throw new Error(r.error || t('callFailed'))
      setShaper((r.shaper as ShaperStatus) ?? {})
      setSelfTest((r.selfTest as SelfTest) ?? {})
    } catch (e) { fail(e) } finally { setBusy(false) }
  }

  const active = openRouterActive({ ...state, providers, hosts })
  const disabled = !state.enabled || saving

  if (!loaded) return <div className="mpro-panel"><div className="mpro-emptyState">{t('loading')}</div></div>

  return (
    <div className="mpro-panel">
      <p className="mpro-hint">{t('orIntro')}</p>

      <div className="mpro-orCard">
        <label className="mpro-check">
          <input type="checkbox" checked={state.enabled} onChange={(e) => setState((s) => ({ ...s, enabled: e.target.checked }))} />
          <span>{t('orEnabled')}</span>
        </label>
        <p className="mpro-hint">{active ? t('orActiveHint') : t('orInactiveHint')}</p>

        <div className="mpro-grid2">
          <label className="mpro-field">
            <span className="mpro-label">{t('orMode')}</span>
            <select
              className="mpro-select"
              disabled={disabled}
              value={state.mode}
              onChange={(e) => setState((s) => ({ ...s, mode: e.target.value === 'order' ? 'order' : 'only' }))}
            >
              <option value="only">{t('orModeOnly')}</option>
              <option value="order">{t('orModeOrder')}</option>
            </select>
          </label>
          <label className="mpro-field">
            <span className="mpro-label">{t('orQuant')}</span>
            <select
              className="mpro-select"
              disabled={disabled}
              value={state.quantization}
              onChange={(e) => setState((s) => ({ ...s, quantization: e.target.value }))}
            >
              <option value={QUANT_OFF}>{`${QUANT_OFF} (${t('orQuantUnlimited')})`}</option>
              {QUANT_LEVELS.map((q) => <option key={q} value={q}>{q}</option>)}
            </select>
          </label>
        </div>
        <p className="mpro-hint">{state.mode === 'order' ? t('orModeOrderHint') : t('orModeOnlyHint')}</p>
        <p className="mpro-hint">{t('orQuantHint')}</p>

        <label className="mpro-field">
          <span className="mpro-label">{t('orProviders')}</span>
          <textarea
            className="mpro-input mpro-inputMono mpro-textarea"
            rows={6}
            disabled={disabled}
            value={text}
            placeholder={t('orProvidersPlaceholder')}
            onChange={(e) => setText(e.target.value)}
          />
        </label>
        <p className="mpro-hint">{`${t('orParsed')}: ${providers.length}`}</p>

        <div className="mpro-grid2">
          <label className="mpro-check">
            <input
              type="checkbox"
              checked={state.attribution}
              onChange={(e) => setState((s) => ({ ...s, attribution: e.target.checked }))}
            />
            <span>{t('orAttribution')}</span>
          </label>
          <label className="mpro-field">
            <span className="mpro-label">{t('orAttributionTitle')}</span>
            <input
              className="mpro-input"
              disabled={disabled || !state.attribution}
              value={state.attributionTitle}
              onChange={(e) => setState((s) => ({ ...s, attributionTitle: e.target.value }))}
            />
          </label>
        </div>

        <label className="mpro-field">
          <span className="mpro-label">{t('orHosts')}</span>
          <input
            className="mpro-input mpro-inputMono"
            disabled={disabled}
            value={hostsText}
            onChange={(e) => setHostsText(e.target.value)}
          />
        </label>
        <p className="mpro-hint">{t('orHostsHint')}</p>

        <div className="mpro-hdrAdd">
          <button className="mpro-btn mpro-btnPrimary" disabled={!dirty || saving} onClick={() => void save()}>
            {saving ? t('saving') : t('orSave')}
          </button>
          <button className="mpro-btn" disabled={!dirty || saving} onClick={discard}>{t('orDiscard')}</button>
          <button className="mpro-btn" disabled={busy} onClick={() => void runImport()}>{t('orImport')}</button>
          <button className="mpro-btn" disabled={busy} onClick={() => void runSelfTest()}>{t('orSelfTest')}</button>
          {dirty ? <span className="mpro-badge">{t('orUnsaved')}</span> : null}
          {inlineStatus}
        </div>
        {importNote !== '' ? <p className="mpro-hint">{importNote}</p> : null}
      </div>

      <h3 className="mpro-subTitle" style={{ marginTop: 18 }}>{t('orStatusTitle')}</h3>
      <table className="mpro-thTable">
        <tbody>
          <tr>
            <td>{t('orShaper')}</td>
            <td>{shaper.installed ? t('orShaperLive') : `${t('orShaperOff')}${shaper.reason ? ` (${shaper.reason})` : ''}`}</td>
          </tr>
          <tr>
            <td>{t('orShaperCalls')}</td>
            <td>{`${shaper.calls ?? 0} / ${t('orShaperShaped')} ${shaper.shaped ?? 0} / ${t('orShaperAttributed')} ${shaper.attributed ?? 0}`}</td>
          </tr>
          <tr>
            <td>{t('orInject')}</td>
            <td>{selfTest.changed ? t('orInjectOn') : t('orInjectOff')}</td>
          </tr>
          <tr>
            <td>{t('orParams')}</td>
            <td className="mpro-inputMono">{selfTest.params ? JSON.stringify(selfTest.params) : '—'}</td>
          </tr>
        </tbody>
      </table>
      <p className="mpro-hint">{t('orSelfTestHint')}</p>
      <p className="mpro-hint">{t('orReasoningHint')}</p>
    </div>
  )
}
