/** ProviderEditor — the tabbed editor view for a single provider. */

import React from '../react'
import type { ProviderData, InfoState, HeaderPair, ModelEntry, DiscoveredModel, StatusMsg, TFunc, CallFn } from '../../shared/types'
import { InfoPanel } from './InfoPanel'
import { HeadersPanel } from './HeadersPanel'
import { ModelsPanel } from './ModelsPanel'

interface Props {
  t: TFunc
  call: CallFn
  data: ProviderData
  onBack: () => void
  fail: (e: unknown) => void
}

export function ProviderEditor({ t, call, data, onBack, fail }: Props) {
  const [tab, setTab] = React.useState<'info' | 'headers' | 'models'>('info')
  const [info, setInfo] = React.useState<InfoState>({
    displayName: data.displayName,
    api: data.api || 'openai-completions',
    baseURL: data.baseURL,
    apiKeyEnv: data.apiKeyEnv,
  })
  const [protocols, setProtocols] = React.useState(['openai-completions', 'openai-responses', 'anthropic-messages'])
  const [headers, setHeaders] = React.useState<HeaderPair[]>(data.headers?.length ? data.headers : [])
  const [models, setModels] = React.useState<ModelEntry[]>(data.models || [])
  const [discovered, setDiscovered] = React.useState<DiscoveredModel[] | null>(null)
  const [selectedIds, setSelectedIds] = React.useState<Record<string, boolean>>({})
  const [apiKeyProbe, setApiKeyProbe] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [status, setStatus] = React.useState<StatusMsg | null>(null)

  const set = (p: Partial<InfoState>) => setInfo((f) => ({ ...f, ...p }))

  React.useEffect(() => {
    call('list-providers').then((r: any) => { if (r.protocols) setProtocols(r.protocols) }).catch(() => {})
  }, [])

  const saveField = async (field: string, value: string) => {
    setBusy(true); setStatus(null)
    try {
      await call('update-field', { route: data.route, field, value })
      setStatus({ kind: 'ok', text: t('statusSaved') })
    } catch (e) { fail(e) } finally { setBusy(false) }
  }

  const saveHeaders = async () => {
    setBusy(true); setStatus(null)
    try {
      await call('update-headers', { route: data.route, headers })
      setStatus({ kind: 'ok', text: t('statusSaved') })
    } catch (e) { fail(e) } finally { setBusy(false) }
  }

  const inlineStatus = status
    ? <div className={status.kind === 'ok' ? 'mpro-inlineStatus mpro-inlineStatusOk' : 'mpro-inlineStatus mpro-inlineStatusErr'}>{status.text}</div>
    : null

  const tabBtn = (id: 'info' | 'headers' | 'models', label: string) => (
    <button
      className={tab === id ? 'mpro-tab mpro-tabActive' : 'mpro-tab'}
      onClick={() => setTab(id)}
    >
      {label}
    </button>
  )

  const activePanel =
    tab === 'info' ? (
      <InfoPanel t={t} info={info} set={set} protocols={protocols} route={data.route} saveField={saveField} inlineStatus={inlineStatus} />
    ) : tab === 'headers' ? (
      <HeadersPanel t={t} headers={headers} setHeaders={setHeaders} busy={busy} saveHeaders={saveHeaders} inlineStatus={inlineStatus} />
    ) : (
      <ModelsPanel
        t={t}
        call={call}
        route={data.route}
        info={info}
        set={set}
        protocols={protocols}
        models={models}
        setModels={setModels}
        discovered={discovered}
        setDiscovered={setDiscovered}
        selectedIds={selectedIds}
        setSelectedIds={setSelectedIds}
        apiKeyProbe={apiKeyProbe}
        setApiKeyProbe={setApiKeyProbe}
        busy={busy}
        setBusy={setBusy}
        setStatus={setStatus}
        fail={fail}
        inlineStatus={inlineStatus}
      />
    )

  return (
    <div className="mpro-root">
      <div className="mpro-card">
        <div className="mpro-editorHead">
          <button className="mpro-btn" onClick={onBack}>← {t('back')}</button>
          <h2 className="mpro-editorRoute">{data.route}</h2>
          {data.disabled ? <span className="mpro-tag mpro-tagOff">{t('disabled')}</span> : null}
        </div>
        <div className="mpro-tabs">
          {tabBtn('info', t('tabInfo'))}
          {tabBtn('headers', `${t('tabHeaders')}${headers.length ? ` (${headers.length})` : ''}`)}
          {tabBtn('models', `${t('tabModels')}${models && models.length ? ` (${models.length})` : ''}`)}
        </div>
        {activePanel}
      </div>
    </div>
  )
}
