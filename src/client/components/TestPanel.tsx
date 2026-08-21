/** TestPanel — the "测试" tab. Picks a model, runs one tiny real inference via
 * the host `test-provider` handler (full credential/header/protocol pipeline),
 * and shows a verdict with latency, stop reason and the reply. */

import React from '../react'
import type { ModelEntry, TestResult, TFunc, CallFn } from '../../shared/types'

interface Props {
  t: TFunc
  call: CallFn
  route: string
  disabled: boolean
  /** Advertised model ids from the host (advisory). */
  modelOptions: string[]
  /** Explicit model entries from the current config. */
  explicitModels: ModelEntry[]
}

export function TestPanel({ t, call, route, disabled, modelOptions, explicitModels }: Props) {
  const allIds: string[] = [
    ...modelOptions,
    ...explicitModels.map((m) => m.id),
  ]
  const options = Array.from(new Set(allIds.filter((x) => x && typeof x === 'string')))

  const [model, setModel] = React.useState(options.length ? options[0] : '')
  const [prompt, setPrompt] = React.useState('')
  const [maxTokens, setMaxTokens] = React.useState(16)
  const [testing, setTesting] = React.useState(false)
  const [result, setResult] = React.useState<TestResult | null>(null)
  const [err, setErr] = React.useState('')

  // Keep selection valid when options change (e.g. models added meanwhile).
  React.useEffect(() => {
    if (options.length === 0) return
    if (!options.includes(model)) setModel(options[0])
  }, [options.join('\u0001')]) // eslint-disable-line react-hooks/exhaustive-deps

  const canTest = !disabled && !!model && !testing

  const run = async () => {
    if (!model) { setErr(t('selectModelFirst')); return }
    setTesting(true); setErr(''); setResult(null)
    try {
      const r = await call('test-provider', {
        route,
        model,
        ...(prompt.trim() ? { prompt: prompt.trim() } : {}),
        maxTokens,
      })
      setResult(r)
    } catch (e) {
      setErr((e as Error)?.message || String(e))
    } finally {
      setTesting(false)
    }
  }

  return (
    <div className="mpro-panel">
      <p className="mpro-hint">{t('testHint')}</p>

      {disabled && (
        <div className="mpro-banner mpro-bannerWarn">{t('disabledCannotTest')}</div>
      )}

      {options.length === 0 ? (
        <div className="mpro-emptyState">{t('emptyModelsToTest')}</div>
      ) : (
        <div className="mpro-testCard">
          <div className="mpro-field">
            <span className="mpro-fieldLabel">{t('modelSelect')}</span>
            <select
              className="mpro-input mpro-select mpro-inputMono"
              value={model}
              onChange={(e) => setModel(e.target.value)}
            >
              {options.map((id) => (
                <option key={id} value={id}>{id}</option>
              ))}
            </select>
          </div>
          <div className="mpro-field">
            <span className="mpro-fieldLabel">{t('promptField')}</span>
            <input
              className="mpro-input"
              value={prompt}
              placeholder={t('promptPlaceholder')}
              onChange={(e) => setPrompt(e.target.value)}
            />
          </div>
          <div className="mpro-testRow">
            <div></div>
            <div className="mpro-field">
              <span className="mpro-fieldLabel">{t('maxTokensField')}</span>
              <input
                className="mpro-input mpro-inputMono"
                type="number"
                min={1}
                max={1024}
                value={maxTokens}
                onChange={(e) => setMaxTokens(Number(e.target.value) || 16)}
              />
            </div>
          </div>
          <div>
            <button className="mpro-btn mpro-btnPrimary" disabled={!canTest} onClick={() => void run()}>
              {testing ? t('testing') : t('runTest')}
            </button>
            {testing && <span className="mpro-testing" style={{ marginLeft: 12 }}><span className="mpro-spin" />{t('testing')}…</span>}
          </div>
        </div>
      )}

      {err && (
        <div className="mpro-resultBlock">
          <div className="mpro-resultLabel">{t('errorTitle')}</div>
          <div className="mpro-errorBlock">{err}</div>
        </div>
      )}

      {result && !result.ok && (
        <div className="mpro-resultBlock">
          <div className="mpro-resultLabel">{t('errorTitle')}</div>
          <div className="mpro-errorBlock">{result.error || t('callFailed')}</div>
        </div>
      )}

      {result && result.ok && (
        <div className="mpro-verdict mpro-verdictOk">
          <div className="mpro-verdictTitle">{t('verdictOk')}</div>
          <div className="mpro-verdictMeta">
            <span>
              {t('latencyLabel')}: <b>{result.latencyMs != null ? `${result.latencyMs} ms` : '—'}</b>
            </span>
            {result.stopReason ? (
              <span>
                {t('stopLabel')}: <b>{result.stopReason}</b>
              </span>
            ) : null}
          </div>
        </div>
      )}

      {result && result.ok && (
        <div className="mpro-resultBlock">
          <div className="mpro-resultLabel">
            {t('replyTitle')}
            {result.truncated ? ` ${t('truncatedSuffix')}` : ''}
          </div>
          <div className="mpro-reply">{result.reply || '—'}</div>
        </div>
      )}
    </div>
  )
}
