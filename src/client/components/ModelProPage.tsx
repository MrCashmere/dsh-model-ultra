/** ModelProPage — the main list view component. */

import React from '../react'
import type { BootState, CreateFormState, StatusMsg, TFunc, CallFn, ProviderData } from '../../shared/types'
import { CreateForm } from './CreateForm'
import { ProviderCard } from './ProviderCard'
import { ProviderEditor } from './ProviderEditor'

interface Props {
  t: TFunc
  call: CallFn
}

export function ModelProPage({ t, call }: Props) {
  const [boot, setBoot] = React.useState<BootState>({ providers: [], protocols: [], writable: true, error: '' })
  const [selected, setSelected] = React.useState<ProviderData | null>(null)
  const [creating, setCreating] = React.useState(false)
  const [form, setForm] = React.useState<CreateFormState>({ route: '', displayName: '', api: 'openai-completions', baseURL: '', apiKeyEnv: '' })
  const [status, setStatus] = React.useState<StatusMsg | null>(null)
  const [busy, setBusy] = React.useState(false)

  const set = (p: Partial<CreateFormState>) => setForm((f) => ({ ...f, ...p }))
  const fail = (e: unknown) => setStatus({ kind: 'err', text: (e as Error)?.message || String(e) })

  const refresh = async () => {
    try {
      const r = await call('list-providers')
      setBoot((b) => ({ ...b, providers: r.providers || [], protocols: r.protocols || [], writable: r.writable !== false, error: '' }))
    } catch (e) { fail(e) }
  }

  React.useEffect(() => { void refresh() }, [])

  const onCreate = async () => {
    if (!form.route.trim()) { setStatus({ kind: 'err', text: t('needRoute') }); return }
    if (!form.baseURL.trim()) { setStatus({ kind: 'err', text: t('needBaseURL') }); return }
    setBusy(true); setStatus(null)
    try {
      const r = await call('create-provider', form as unknown as Record<string, unknown>)
      setStatus({ kind: 'ok', text: t('statusCreated').replace('{route}', r.route) })
      setForm({ route: '', displayName: '', api: 'openai-completions', baseURL: '', apiKeyEnv: '' })
      setCreating(false); await refresh()
    } catch (e) { fail(e) } finally { setBusy(false) }
  }

  const onDelete = async (route: string) => {
    // `confirm` is a browser global available in the client sandbox.
    if (!confirm(t('deleteConfirm').replace('{route}', route))) return
    setBusy(true); setStatus(null)
    try {
      await call('delete-provider', { route })
      setStatus({ kind: 'ok', text: t('statusDeleted').replace('{route}', route) })
      if (selected && selected.route === route) setSelected(null)
      await refresh()
    } catch (e) { fail(e) } finally { setBusy(false) }
  }

  const onToggle = async (route: string, enable: boolean) => {
    setBusy(true); setStatus(null)
    try {
      const r = await call('toggle-provider', { route, enabled: enable })
      setStatus({ kind: 'ok', text: t('statusToggled').replace('{route}', r.route).replace('{action}', enable ? t('enable') : t('disable')) })
      await refresh()
    } catch (e) { fail(e) } finally { setBusy(false) }
  }

  const openEdit = async (route: string) => {
    setBusy(true); setStatus(null)
    try {
      const r = await call('get-provider', { route })
      setSelected(r)
    } catch (e) { fail(e) } finally { setBusy(false) }
  }

  if (selected) {
    return (
      <ProviderEditor
        t={t}
        call={call}
        data={selected}
        onBack={() => { setSelected(null); void refresh() }}
        fail={fail}
      />
    )
  }

  let banner: React.ReactElement | null = null
  if (boot.writable === false) {
    banner = <div className="mpro-banner mpro-bannerWarn">{t('readOnly')}</div>
  } else if (status) {
    banner = <div className={status.kind === 'ok' ? 'mpro-banner mpro-bannerOk' : 'mpro-banner mpro-bannerErr'}>{status.text}</div>
  }

  const writable = boot.writable !== false

  return (
    <div className="mpro-root">
      <div className="mpro-head">
        <h2>{t('title')}</h2>
        <div className="mpro-headActions">
          <button className="mpro-btn" onClick={() => void refresh()}>{t('refresh')}</button>
          {writable && (
            <button className="mpro-btn mpro-btnPrimary" onClick={() => setCreating((c) => !c)}>
              {t('newProvider')}
            </button>
          )}
        </div>
      </div>
      <p className="mpro-intro">{t('intro')}</p>
      {banner}
      {creating && (
        <CreateForm
          t={t}
          form={form}
          set={set}
          protocols={boot.protocols}
          busy={busy}
          onCreate={onCreate}
          onCancel={() => { setCreating(false); setForm({ route: '', displayName: '', api: 'openai-completions', baseURL: '', apiKeyEnv: '' }) }}
        />
      )}
      <div>
        {boot.providers.length === 0 ? (
          <div className="mpro-emptyState">{t('empty')}</div>
        ) : (
          <div className="mpro-pcList">
            {boot.providers.map((p) => (
              <ProviderCard
                key={p.route}
                p={p}
                t={t}
                busy={busy}
                writable={writable}
                onEdit={openEdit}
                onToggle={onToggle}
                onDelete={onDelete}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
