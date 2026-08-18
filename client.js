const NS = 'settings.dsh-model-pro'
var ZH = {
  nav: '模型 Pro', title: '模型 Pro',
  intro: '集中管理 llm-pi-ai 提供商:新增 / 删除 / 编辑 baseURL·api·apiKeyEnv·自定义 headers;一键拉取远端模型并全选/反选批量写入。',
  readOnly: '当前设置为只读,无法写入。', callFailed: '调用失败', refresh: '刷新',
  newProvider: '新增提供商', routeField: '路由名 (route)', routePlaceholder: '如 my-gateway',
  displayNameField: '显示名称', apiField: '协议 (api)', baseURLField: 'Base URL',
  apiKeyEnvField: 'API Key Env (如 MY_API_KEY)', create: '创建', creating: '创建中…', cancel: '取消',
  empty: '暂无已配置的提供商,点击右上角「新增提供商」开始。', providers: '已配置提供商', edit: '编辑', delete: '删除',
  deleteConfirm: '确定删除提供商「{route}」及其所有模型配置吗?此操作立即写入设置。',
  statusDeleted: '已删除提供商 {route}。', statusCreated: '已创建提供商 {route}。', statusSaved: '已保存。',
  back: '返回列表', providerInfo: '提供商信息', headersTitle: '自定义请求头',
  headersHint: 'authorization / api-key 由适配器自动填充,请勿在此设置。',
  headerName: 'Header 名', headerValue: 'Header 值', addHeader: '+ 新增', saveHeaders: '保存 Headers',
  modelsTitle: '模型列表', modelsHint: '使用目录的提供商应用后转为显式列表。自定义提供商必须至少保留一个模型。',
  discover: '获取模型', discovering: '拉取中…', discoverHint: '调用 GET /models (仅 openai-completions / openai-responses 可读)。',
  apiKeyProbe: 'API Key (可选)', selectAll: '全选', unselectAll: '取消全选', invert: '反选',
  applyReplace: '替换为选中', applyMerge: '合并选中', removeSelected: '删除选中',
  idCol: '模型 ID', nameCol: '显示名', ctxCol: '上下文', outCol: '最大输出',
  statusModels: '已写入 {count} 个模型。', needRoute: '请填写 route。', needBaseURL: '新建提供商必须填写 baseURL。',
  usesCatalog: '目录', explicit: '显式', emptyModels: '该提供商暂无显式模型条目。',
  enable: '启用', disable: '禁用', disabled: '已禁用', enabled: '已启用', statusToggled: '已{action}提供商 {route}。',
  tabInfo: '基本信息', tabHeaders: '请求头', tabModels: '模型',
}
var EN = {
  nav: 'Model Pro', title: 'Model Pro',
  intro: 'Manage llm-pi-ai providers: create/delete/edit baseURL·api·apiKeyEnv·custom headers; pull remote models with select-all/invert.',
  readOnly: 'Settings are read-only.', callFailed: 'Call failed', refresh: 'Refresh',
  newProvider: 'New provider', routeField: 'Route', routePlaceholder: 'e.g. my-gateway',
  displayNameField: 'Display name', apiField: 'API', baseURLField: 'Base URL',
  apiKeyEnvField: 'API Key Env (e.g. MY_API_KEY)', create: 'Create', creating: 'Creating…', cancel: 'Cancel',
  empty: 'No providers yet. Click "New provider" to start.', providers: 'Providers', edit: 'Edit', delete: 'Delete',
  deleteConfirm: 'Delete provider "{route}" and all its model config? This writes immediately.',
  statusDeleted: 'Deleted provider {route}.', statusCreated: 'Created provider {route}.', statusSaved: 'Saved.',
  back: 'Back', providerInfo: 'Provider info', headersTitle: 'Custom headers',
  headersHint: 'authorization / api-key are auto-filled by the adapter; do not set them here.',
  headerName: 'Header name', headerValue: 'Header value', addHeader: '+ Add', saveHeaders: 'Save headers',
  modelsTitle: 'Models', modelsHint: 'A catalog-route provider converts to explicit on apply. Custom providers must keep at least one model.',
  discover: 'Fetch models', discovering: 'Fetching…', discoverHint: 'Calls GET /models (only openai-completions / openai-responses).',
  apiKeyProbe: 'API Key (optional)', selectAll: 'Select all', unselectAll: 'Clear', invert: 'Invert',
  applyReplace: 'Replace selected', applyMerge: 'Merge selected', removeSelected: 'Remove selected',
  idCol: 'Model ID', nameCol: 'Name', ctxCol: 'Context', outCol: 'Max out',
  statusModels: 'Wrote {count} models.', needRoute: 'Enter a route.', needBaseURL: 'New provider needs a baseURL.',
  usesCatalog: 'catalog', explicit: 'explicit', emptyModels: 'No explicit models yet.',
  enable: 'Enable', disable: 'Disable', disabled: 'Disabled', enabled: 'Enabled', statusToggled: 'Provider {route} {action}.',
  tabInfo: 'Info', tabHeaders: 'Headers', tabModels: 'Models',
}
var CSS = [
  '.mpro-root{--mpro-gap:16px;--mpro-radius:10px;--mpro-radius-sm:6px;max-width:760px;margin:0 auto;padding:0 0 40px;color:var(--dsw-alias-label-primary);font-size:13px;line-height:1.5}',
  '.mpro-head{display:flex;align-items:baseline;justify-content:space-between;margin-bottom:4px}',
  '.mpro-head h2{font-size:18px;font-weight:600;margin:0;letter-spacing:-0.01em}',
  '.mpro-headActions{display:flex;gap:6px;align-items:center}',
  '.mpro-intro{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:1.6;margin:0 0 20px}',
  '.mpro-banner{padding:8px 12px;border-radius:var(--mpro-radius-sm);font-size:12px;margin-bottom:12px}',
  '.mpro-bannerOk{background:var(--dsw-alias-state-success-fill);color:var(--dsw-alias-state-success-label)}',
  '.mpro-bannerErr{background:var(--dsw-alias-state-error-fill);color:var(--dsw-alias-state-error-label)}',
  '.mpro-bannerWarn{background:var(--dsw-alias-state-warn-fill);color:var(--dsw-alias-state-warn-label)}',
  '.mpro-btn{height:28px;padding:0 12px;border-radius:var(--mpro-radius-sm);border:1px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-primary);font-size:12px;font-family:inherit;cursor:pointer;white-space:nowrap;transition:background .12s,border-color .12s;display:inline-flex;align-items:center;gap:4px}',
  '.mpro-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}',
  '.mpro-btn:disabled{opacity:.4;cursor:default}',
  '.mpro-btnPrimary{background:var(--dsw-alias-brand-primary);color:#fff;border-color:transparent}',
  '.mpro-btnPrimary:hover:not(:disabled){background:var(--dsw-alias-brand-primary-hover,var(--dsw-alias-brand-primary))}',
  '.mpro-btnDanger{color:var(--dsw-alias-state-error-primary)}',
  '.mpro-btnDanger:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover-danger)}',
  '.mpro-btnSm{height:24px;padding:0 8px;font-size:11px}',
  '.mpro-card{background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1);border-radius:var(--mpro-radius);padding:0;overflow:hidden}',
  '.mpro-cardHead{display:flex;align-items:center;justify-content:space-between;padding:12px 16px;border-bottom:1px solid var(--dsw-alias-border-l1)}',
  '.mpro-cardTitle{font-size:13px;font-weight:600;margin:0}',
  '.mpro-cardBody{padding:12px 16px;display:flex;flex-direction:column;gap:12px}',
  '.mpro-grid2{display:grid;grid-template-columns:1fr 1fr;gap:12px}',
  '.mpro-grid2 .mpro-fieldFull{grid-column:1/-1}',
  '.mpro-field{display:flex;flex-direction:column;gap:4px}',
  '.mpro-fieldLabel{font-size:11px;font-weight:500;color:var(--dsw-alias-label-secondary);text-transform:uppercase;letter-spacing:0.04em}',
  '.mpro-input{box-sizing:border-box;width:100%;height:30px;padding:0 10px;border-radius:var(--mpro-radius-sm);border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-family:inherit;font-size:12px;transition:border-color .12s}',
  '.mpro-input:focus{outline:none;border-color:var(--dsw-alias-brand-primary)}',
  '.mpro-input::placeholder{color:var(--dsw-alias-label-quaternary)}',
  '.mpro-select{appearance:auto;cursor:pointer}',
  '.mpro-hint{font-size:11px;color:var(--dsw-alias-label-tertiary);line-height:1.5;margin:0}',
  '.mpro-pcList{display:flex;flex-direction:column;gap:8px}',
  '.mpro-pc{display:flex;align-items:center;gap:12px;padding:12px 14px;border:1px solid var(--dsw-alias-border-l1);border-radius:var(--mpro-radius);background:var(--dsw-alias-bg-layer-2);transition:border-color .12s}',
  '.mpro-pc:hover{border-color:var(--dsw-alias-border-l2)}',
  '.mpro-pcDisabled{opacity:.55}',
  '.mpro-pcDot{flex:none;width:8px;height:8px;border-radius:50%;background:var(--dsw-alias-state-success-primary)}',
  '.mpro-pcDotOff{background:var(--dsw-alias-state-error-primary)}',
  '.mpro-pcDotCat{background:var(--dsw-alias-brand-primary)}',
  '.mpro-pcInfo{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}',
  '.mpro-pcName{font-size:13px;font-weight:600;display:flex;align-items:center;gap:6px}',
  '.mpro-pcMeta{font-size:11px;color:var(--dsw-alias-label-tertiary);display:flex;gap:10px;flex-wrap:wrap}',
  '.mpro-pcMeta span{white-space:nowrap}',
  '.mpro-pcActions{display:flex;gap:4px;align-items:center;flex:none}',
  '.mpro-tag{display:inline-block;padding:0 5px;height:18px;line-height:18px;border-radius:3px;font-size:10px;font-weight:500;letter-spacing:.02em}',
  '.mpro-tagCat{background:var(--dsw-alias-brand-primary-alpha-15,rgba(99,102,241,.12));color:var(--dsw-alias-brand-primary)}',
  '.mpro-tagExp{background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-secondary)}',
  '.mpro-tagOff{background:var(--dsw-alias-state-error-fill);color:var(--dsw-alias-state-error-label)}',
  '.mpro-tabs{display:flex;gap:0;border-bottom:1px solid var(--dsw-alias-border-l1)}',
  '.mpro-tab{padding:8px 16px;font-size:12px;font-weight:500;color:var(--dsw-alias-label-secondary);cursor:pointer;border:none;background:none;border-bottom:2px solid transparent;transition:color .12s,border-color .12s;font-family:inherit}',
  '.mpro-tab:hover{color:var(--dsw-alias-label-primary)}',
  '.mpro-tabActive{color:var(--dsw-alias-brand-primary);border-bottom-color:var(--dsw-alias-brand-primary)}',
  '.mpro-editorHead{display:flex;align-items:center;gap:10px;padding:12px 16px;border-bottom:1px solid var(--dsw-alias-border-l1)}',
  '.mpro-editorRoute{font-size:15px;font-weight:600;margin:0;flex:1}',
  '.mpro-hdrRow{display:grid;grid-template-columns:160px 1fr 28px;gap:8px;align-items:center}',
  '.mpro-modelBar{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:8px}',
  '.mpro-modelBar .mpro-chip{margin-left:auto}',
  '.mpro-chip{display:inline-flex;align-items:center;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:500;background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-secondary)}',
  '.mpro-tblWrap{overflow-x:auto;border:1px solid var(--dsw-alias-border-l1);border-radius:var(--mpro-radius-sm)}',
  '.mpro-tbl{width:100%;border-collapse:collapse;font-size:11px}',
  '.mpro-tbl th{text-align:left;padding:6px 10px;font-weight:500;color:var(--dsw-alias-label-secondary);border-bottom:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-2);white-space:nowrap}',
  '.mpro-tbl td{padding:5px 10px;border-bottom:1px solid var(--dsw-alias-border-l1)}',
  '.mpro-tbl tr:last-child td{border-bottom:none}',
  '.mpro-tbl tbody tr:hover{background:var(--dsw-alias-interactive-bg-hover)}',
  '.mpro-tblCk{text-align:center;width:28px}',
  '.mpro-emptyState{padding:24px 16px;text-align:center;color:var(--dsw-alias-label-tertiary);font-size:12px}',
  '.mpro-inlineStatus{font-size:11px;padding:2px 0}',
  '.mpro-inlineStatusOk{color:var(--dsw-alias-state-success-primary)}',
  '.mpro-inlineStatusErr{color:var(--dsw-alias-state-error-primary)}',
  '@media(max-width:600px){.mpro-grid2{grid-template-columns:1fr}.mpro-hdrRow{grid-template-columns:120px 1fr 24px}}',
].join('\n')

function emptyNew() {
  return { route: '', displayName: '', api: 'openai-completions', baseURL: '', apiKeyEnv: '' }
}

function ModelProPage(props) {
  var t = props.t, call = props.call
  var bootS = React.useState({ providers: [], protocols: [], writable: true, error: '' })
  var setBoot = bootS[1]; var boot = bootS[0]
  var selectedS = React.useState(null)
  var setSelected = selectedS[1]; var selected = selectedS[0]
  var creatingS = React.useState(false)
  var setCreating = creatingS[1]; var creating = creatingS[0]
  var formS = React.useState(emptyNew())
  var setForm = formS[1]; var form = formS[0]
  var statusS = React.useState(null)
  var setStatus = statusS[1]; var status = statusS[0]
  var busyS = React.useState(false)
  var setBusy = busyS[1]; var busy = busyS[0]
  var set = function (p) { setForm(function (f) { return Object.assign({}, f, p) }) }
  var fail = function (e) { setStatus({ kind: 'err', text: (e && e.message) || String(e) }) }
  var refresh = async function () {
    try {
      var r = await call('list-providers')
      setBoot(function (b) { return Object.assign({}, b, { providers: r.providers || [], protocols: r.protocols || [], writable: r.writable !== false, error: '' }) })
    } catch (e) { fail(e) }
  }
  React.useEffect(function () { void refresh() }, [])
  var onCreate = async function () {
    if (!form.route.trim()) { setStatus({ kind: 'err', text: t('needRoute') }); return }
    if (!form.baseURL.trim()) { setStatus({ kind: 'err', text: t('needBaseURL') }); return }
    setBusy(true); setStatus(null)
    try {
      var r = await call('create-provider', form)
      setStatus({ kind: 'ok', text: t('statusCreated').replace('{route}', r.route) })
      setForm(emptyNew()); setCreating(false); await refresh()
    } catch (e) { fail(e) } finally { setBusy(false) }
  }
  var onDelete = async function (route) {
    if (!window.confirm(t('deleteConfirm').replace('{route}', route))) return
    setBusy(true); setStatus(null)
    try {
      await call('delete-provider', { route: route })
      setStatus({ kind: 'ok', text: t('statusDeleted').replace('{route}', route) })
      if (selected && selected.route === route) setSelected(null)
      await refresh()
    } catch (e) { fail(e) } finally { setBusy(false) }
  }
  var onToggle = async function (route, enable) {
    setBusy(true); setStatus(null)
    try {
      var r = await call('toggle-provider', { route: route, enabled: enable })
      setStatus({ kind: 'ok', text: t('statusToggled').replace('{route}', r.route).replace('{action}', enable ? t('enable') : t('disable')) })
      await refresh()
    } catch (e) { fail(e) } finally { setBusy(false) }
  }
  var openEdit = async function (route) {
    setBusy(true); setStatus(null)
    try {
      var r = await call('get-provider', { route: route })
      setSelected(r)
    } catch (e) { fail(e) } finally { setBusy(false) }
  }
  if (selected) return React.createElement(ProviderEditor, { t: t, call: call, data: selected, onBack: function () { setSelected(null); void refresh() }, fail: fail })

  var banner = null
  if (boot.writable === false) {
    banner = React.createElement('div', { className: 'mpro-banner mpro-bannerWarn' }, t('readOnly'))
  } else if (status) {
    banner = React.createElement('div', { className: status.kind === 'ok' ? 'mpro-banner mpro-bannerOk' : 'mpro-banner mpro-bannerErr' }, status.text)
  }

  var createForm = null
  if (creating) {
    createForm = React.createElement('div', { className: 'mpro-card' },
      React.createElement('div', { className: 'mpro-cardHead' },
        React.createElement('span', { className: 'mpro-cardTitle' }, t('newProvider')),
        React.createElement('button', { className: 'mpro-btn mpro-btnSm', onClick: function () { setCreating(false); setForm(emptyNew()) } }, t('cancel'))
      ),
      React.createElement('div', { className: 'mpro-cardBody' },
        React.createElement('div', { className: 'mpro-grid2' },
          React.createElement('div', { className: 'mpro-field' },
            React.createElement('span', { className: 'mpro-fieldLabel' }, t('routeField')),
            React.createElement('input', { className: 'mpro-input', value: form.route, placeholder: t('routePlaceholder'), onChange: function (e) { set({ route: e.target.value }) } })
          ),
          React.createElement('div', { className: 'mpro-field' },
            React.createElement('span', { className: 'mpro-fieldLabel' }, t('displayNameField')),
            React.createElement('input', { className: 'mpro-input', value: form.displayName, onChange: function (e) { set({ displayName: e.target.value }) } })
          ),
          React.createElement('div', { className: 'mpro-field' },
            React.createElement('span', { className: 'mpro-fieldLabel' }, t('apiField')),
            React.createElement('select', { className: 'mpro-input mpro-select', value: form.api, onChange: function (e) { set({ api: e.target.value }) } },
              (boot.protocols && boot.protocols.length ? boot.protocols : ['openai-completions', 'openai-responses', 'anthropic-messages']).map(function (p) { return React.createElement('option', { key: p, value: p }, p) })
            )
          ),
          React.createElement('div', { className: 'mpro-field' },
            React.createElement('span', { className: 'mpro-fieldLabel' }, t('baseURLField')),
            React.createElement('input', { className: 'mpro-input', value: form.baseURL, placeholder: 'https://api.example.com/v1', onChange: function (e) { set({ baseURL: e.target.value }) } })
          )
        ),
        React.createElement('div', { className: 'mpro-field' },
          React.createElement('span', { className: 'mpro-fieldLabel' }, t('apiKeyEnvField')),
          React.createElement('input', { className: 'mpro-input', value: form.apiKeyEnv, onChange: function (e) { set({ apiKeyEnv: e.target.value }) } })
        ),
        React.createElement('div', { style: { display: 'flex', gap: '8px' } },
          React.createElement('button', { className: 'mpro-btn mpro-btnPrimary', disabled: busy, onClick: onCreate }, busy ? t('creating') : t('create'))
        )
      )
    )
  }

  var pcList = null
  if (boot.providers.length === 0) {
    pcList = React.createElement('div', { className: 'mpro-emptyState' }, t('empty'))
  } else {
    var cards = boot.providers.map(function (p) {
      var dotClass = 'mpro-pcDot'
      var tag = null
      if (p.disabled) { dotClass = 'mpro-pcDotOff'; tag = React.createElement('span', { className: 'mpro-tag mpro-tagOff' }, t('disabled')) }
      else if (p.usesCatalog) { dotClass = 'mpro-pcDotCat'; tag = React.createElement('span', { className: 'mpro-tag mpro-tagCat' }, t('usesCatalog')) }
      else { tag = React.createElement('span', { className: 'mpro-tag mpro-tagExp' }, t('explicit')) }
      return React.createElement('div', { key: p.route, className: p.disabled ? 'mpro-pc mpro-pcDisabled' : 'mpro-pc' },
        React.createElement('div', { className: dotClass }),
        React.createElement('div', { className: 'mpro-pcInfo' },
          React.createElement('div', { className: 'mpro-pcName' }, p.route, tag),
          React.createElement('div', { className: 'mpro-pcMeta' },
            React.createElement('span', null, p.api || '—'),
            React.createElement('span', null, p.baseURL ? p.baseURL.replace(/^https?:\/\//, '').replace(/\/$/, '') : '—'),
            React.createElement('span', null, String(p.modelCount) + ' models'),
            p.headerCount ? React.createElement('span', null, String(p.headerCount) + ' headers') : null
          )
        ),
        React.createElement('div', { className: 'mpro-pcActions' },
          React.createElement('button', { className: 'mpro-btn mpro-btnSm', onClick: function () { void openEdit(p.route) } }, t('edit')),
          boot.writable !== false ? React.createElement('button', { className: 'mpro-btn mpro-btnSm', disabled: busy, onClick: function () { void onToggle(p.route, !!p.disabled) } }, p.disabled ? t('enable') : t('disable')) : null,
          boot.writable !== false ? React.createElement('button', { className: 'mpro-btn mpro-btnSm mpro-btnDanger', disabled: busy, onClick: function () { void onDelete(p.route) } }, t('delete')) : null
        )
      )
    })
    pcList = React.createElement('div', { className: 'mpro-pcList' }, cards)
  }

  return React.createElement('div', { className: 'mpro-root' },
    React.createElement('div', { className: 'mpro-head' },
      React.createElement('h2', null, t('title')),
      React.createElement('div', { className: 'mpro-headActions' },
        React.createElement('button', { className: 'mpro-btn', onClick: function () { void refresh() } }, t('refresh')),
        boot.writable !== false ? React.createElement('button', { className: 'mpro-btn mpro-btnPrimary', onClick: function () { setCreating(function (c) { return !c }) } }, t('newProvider')) : null
      )
    ),
    React.createElement('p', { className: 'mpro-intro' }, t('intro')),
    banner,
    createForm,
    React.createElement('div', null, pcList)
  )
}

function ProviderEditor(props) {
  var t = props.t, call = props.call, data = props.data, onBack = props.onBack, fail = props.fail
  var tabS = React.useState('info')
  var setTab = tabS[1]; var tab = tabS[0]
  var infoS = React.useState({ displayName: data.displayName, api: data.api || 'openai-completions', baseURL: data.baseURL, apiKeyEnv: data.apiKeyEnv })
  var setInfo = infoS[1]; var info = infoS[0]
  var protosS = React.useState(['openai-completions', 'openai-responses', 'anthropic-messages'])
  var setProtocols = protosS[1]; var protocols = protosS[0]
  var hdrS = React.useState((data.headers || []).length ? data.headers : [])
  var setHeaders = hdrS[1]; var headers = hdrS[0]
  var modS = React.useState(data.models || [])
  var setModels = modS[1]; var models = modS[0]
  var dscS = React.useState(null)
  var setDiscovered = dscS[1]; var discovered = dscS[0]
  var selS = React.useState({})
  var setSelectedIds = selS[1]; var selectedIds = selS[0]
  var keyS = React.useState('')
  var setApiKeyProbe = keyS[1]; var apiKeyProbe = keyS[0]
  var busyS = React.useState(false)
  var setBusy = busyS[1]; var busy = busyS[0]
  var stS = React.useState(null)
  var setStatus = stS[1]; var status = stS[0]
  var set = function (p) { setInfo(function (f) { return Object.assign({}, f, p) }) }
  React.useEffect(function () {
    call('list-providers').then(function (r) { if (r.protocols) setProtocols(r.protocols) }).catch(function () {})
  }, [])
  var saveField = async function (field, value) {
    setBusy(true); setStatus(null)
    try { await call('update-field', { route: data.route, field: field, value: value }); setStatus({ kind: 'ok', text: t('statusSaved') }) }
    catch (e) { fail(e) } finally { setBusy(false) }
  }
  var saveHeaders = async function () {
    setBusy(true); setStatus(null)
    try { await call('update-headers', { route: data.route, headers: headers }); setStatus({ kind: 'ok', text: t('statusSaved') }) }
    catch (e) { fail(e) } finally { setBusy(false) }
  }
  var addHeader = function () { setHeaders(function (h) { return h.concat([{ name: '', value: '' }]) }) }
  var setHeader = function (i, patch) { setHeaders(function (h) { return h.map(function (r, idx) { return idx === i ? Object.assign({}, r, patch) : r }) }) }
  var removeHeader = function (i) { setHeaders(function (h) { return h.filter(function (_, idx) { return idx !== i }) }) }
  var discover = async function () {
    setBusy(true); setStatus(null); setDiscovered(null); setSelectedIds({})
    try {
      var r = await call('discover-models', { route: data.route, baseURL: info.baseURL, api: info.api, apiKey: apiKeyProbe })
      var list = r.models || []
      setDiscovered(list)
      var sel = {}; list.forEach(function (m) { sel[m.id] = true }); setSelectedIds(sel)
    } catch (e) { fail(e) } finally { setBusy(false) }
  }
  var toggleSel = function (id) { setSelectedIds(function (s) { var n = Object.assign({}, s); n[id] = !s[id]; return n }) }
  var selectAll = function () { var s = {}; (discovered || []).forEach(function (m) { s[m.id] = true }); setSelectedIds(s) }
  var unselectAll = function () { setSelectedIds({}) }
  var invert = function () { var s = {}; (discovered || []).forEach(function (m) { s[m.id] = !selectedIds[m.id] }); setSelectedIds(s) }
  var selectedModels = (discovered || []).filter(function (m) { return selectedIds[m.id] })
  var applyModels = async function (mode) {
    if (!selectedModels.length) return
    setBusy(true); setStatus(null)
    try {
      var r = await call('apply-models', { route: data.route, models: selectedModels, mode: mode })
      setStatus({ kind: 'ok', text: t('statusModels').replace('{count}', String(r.count)) })
      var fresh = await call('get-provider', { route: data.route })
      setModels(fresh.models || [])
    } catch (e) { fail(e) } finally { setBusy(false) }
  }
  var removeSelected = async function () {
    var marked = (models || []).filter(function (m) { return selectedIds[m.id] })
    if (!marked.length) return
    setBusy(true); setStatus(null)
    try {
      var r = await call('apply-models', { route: data.route, models: marked, mode: 'remove' })
      setStatus({ kind: 'ok', text: t('statusModels').replace('{count}', String(r.count)) })
      var fresh = await call('get-provider', { route: data.route })
      setModels(fresh.models || [])
    } catch (e) { fail(e) } finally { setBusy(false) }
  }

  var inlineStatus = status ? React.createElement('div', { className: status.kind === 'ok' ? 'mpro-inlineStatus mpro-inlineStatusOk' : 'mpro-inlineStatus mpro-inlineStatusErr' }, status.text) : null

  var tabBtn = function (id, label) {
    return React.createElement('button', { className: tab === id ? 'mpro-tab mpro-tabActive' : 'mpro-tab', onClick: function () { setTab(id) } }, label)
  }

  var infoPanel = React.createElement('div', { className: 'mpro-cardBody' },
    React.createElement('div', { className: 'mpro-grid2' },
      React.createElement('div', { className: 'mpro-field' },
        React.createElement('span', { className: 'mpro-fieldLabel' }, t('displayNameField')),
        React.createElement('input', { className: 'mpro-input', value: info.displayName, onChange: function (e) { set({ displayName: e.target.value }) }, onBlur: function () { void saveField('displayName', info.displayName) } })
      ),
      React.createElement('div', { className: 'mpro-field' },
        React.createElement('span', { className: 'mpro-fieldLabel' }, t('apiField')),
        React.createElement('select', { className: 'mpro-input mpro-select', value: info.api, onChange: function (e) { set({ api: e.target.value }); void saveField('api', e.target.value) } },
          protocols.map(function (p) { return React.createElement('option', { key: p, value: p }, p) })
        )
      )
    ),
    React.createElement('div', { className: 'mpro-field' },
      React.createElement('span', { className: 'mpro-fieldLabel' }, t('baseURLField')),
      React.createElement('input', { className: 'mpro-input', value: info.baseURL, onChange: function (e) { set({ baseURL: e.target.value }) }, onBlur: function () { void saveField('baseURL', info.baseURL) } })
    ),
    React.createElement('div', { className: 'mpro-field' },
      React.createElement('span', { className: 'mpro-fieldLabel' }, t('apiKeyEnvField')),
      React.createElement('input', { className: 'mpro-input', value: info.apiKeyEnv, onChange: function (e) { set({ apiKeyEnv: e.target.value }) }, onBlur: function () { void saveField('apiKeyEnv', info.apiKeyEnv) } })
    ),
    inlineStatus
  )

  var headerRows = headers.map(function (h, i) {
    return React.createElement('div', { key: i, className: 'mpro-hdrRow' },
      React.createElement('input', { className: 'mpro-input', value: h.name, placeholder: t('headerName'), onChange: function (e) { setHeader(i, { name: e.target.value }) } }),
      React.createElement('input', { className: 'mpro-input', value: h.value, placeholder: t('headerValue'), onChange: function (e) { setHeader(i, { value: e.target.value }) } }),
      React.createElement('button', { className: 'mpro-btn mpro-btnSm mpro-btnDanger', onClick: function () { removeHeader(i) } }, '×')
    )
  })
  var headersPanel = React.createElement('div', { className: 'mpro-cardBody' },
    React.createElement('p', { className: 'mpro-hint' }, t('headersHint')),
    headerRows.length > 0 ? React.createElement('div', null, headerRows) : React.createElement('div', { className: 'mpro-emptyState' }, t('emptyModels')),
    React.createElement('div', { style: { display: 'flex', gap: '8px' } },
      React.createElement('button', { className: 'mpro-btn', onClick: addHeader }, t('addHeader')),
      React.createElement('button', { className: 'mpro-btn mpro-btnPrimary', disabled: busy, onClick: saveHeaders }, t('saveHeaders'))
    ),
    inlineStatus
  )

  var modelSectionChildren = [
    React.createElement('p', { className: 'mpro-hint' }, t('modelsHint')),
    React.createElement('div', { className: 'mpro-grid2' },
      React.createElement('div', { className: 'mpro-field' },
        React.createElement('span', { className: 'mpro-fieldLabel' }, t('baseURLField')),
        React.createElement('input', { className: 'mpro-input', value: info.baseURL, placeholder: t('baseURLField'), onChange: function (e) { set({ baseURL: e.target.value }) } })
      ),
      React.createElement('div', { className: 'mpro-field' },
        React.createElement('span', { className: 'mpro-fieldLabel' }, t('apiField')),
        React.createElement('select', { className: 'mpro-input mpro-select', value: info.api, onChange: function (e) { set({ api: e.target.value }) } },
          protocols.map(function (p) { return React.createElement('option', { key: p, value: p }, p) })
        )
      )
    ),
    React.createElement('div', { className: 'mpro-field' },
      React.createElement('span', { className: 'mpro-fieldLabel' }, t('apiKeyProbe')),
      React.createElement('input', { className: 'mpro-input', type: 'password', value: apiKeyProbe, placeholder: t('apiKeyProbe'), onChange: function (e) { setApiKeyProbe(e.target.value) } })
    ),
    React.createElement('button', { className: 'mpro-btn mpro-btnPrimary', disabled: busy, onClick: discover }, busy ? t('discovering') : t('discover')),
    React.createElement('p', { className: 'mpro-hint' }, t('discoverHint')),
  ]
  if (discovered) {
    var dRows = discovered.map(function (m) {
      return React.createElement('tr', { key: m.id },
        React.createElement('td', { className: 'mpro-tblCk' }, React.createElement('input', { type: 'checkbox', checked: !!selectedIds[m.id], onChange: function () { toggleSel(m.id) } })),
        React.createElement('td', null, m.id),
        React.createElement('td', null, m.name || m.id),
        React.createElement('td', null, m.contextWindow ? String(m.contextWindow) : '—'),
        React.createElement('td', null, m.maxTokens ? String(m.maxTokens) : '—')
      )
    })
    modelSectionChildren.push(React.createElement('div', { className: 'mpro-modelBar' },
      React.createElement('button', { className: 'mpro-btn mpro-btnSm', onClick: selectAll }, t('selectAll')),
      React.createElement('button', { className: 'mpro-btn mpro-btnSm', onClick: unselectAll }, t('unselectAll')),
      React.createElement('button', { className: 'mpro-btn mpro-btnSm', onClick: invert }, t('invert')),
      React.createElement('span', { className: 'mpro-chip' }, String(selectedModels.length) + '/' + String(discovered.length))
    ))
    modelSectionChildren.push(React.createElement('div', { className: 'mpro-tblWrap' },
      React.createElement('table', { className: 'mpro-tbl' },
        React.createElement('thead', null, React.createElement('tr', null,
          React.createElement('th', { className: 'mpro-tblCk' }, ''),
          React.createElement('th', null, t('idCol')),
          React.createElement('th', null, t('nameCol')),
          React.createElement('th', null, t('ctxCol')),
          React.createElement('th', null, t('outCol'))
        )),
        React.createElement('tbody', null, dRows)
      )
    ))
    modelSectionChildren.push(React.createElement('div', { style: { display: 'flex', gap: '8px' } },
      React.createElement('button', { className: 'mpro-btn mpro-btnPrimary', disabled: busy || !selectedModels.length, onClick: function () { void applyModels('replace') } }, t('applyReplace')),
      React.createElement('button', { className: 'mpro-btn', disabled: busy || !selectedModels.length, onClick: function () { void applyModels('merge') } }, t('applyMerge'))
    ))
  }
  modelSectionChildren.push(React.createElement('div', { style: { marginTop: '8px', display: 'flex', alignItems: 'center', gap: '8px' } },
    React.createElement('span', { className: 'mpro-fieldLabel', style: { margin: '0' } }, t('modelsTitle') + ' (' + String((models || []).length) + ')'),
    models && models.some(function (m) { return selectedIds[m.id] }) ? React.createElement('button', { className: 'mpro-btn mpro-btnSm mpro-btnDanger', disabled: busy, onClick: removeSelected }, t('removeSelected')) : null
  ))
  if (models && models.length) {
    var mRows = models.map(function (m) {
      return React.createElement('tr', { key: m.id },
        React.createElement('td', { className: 'mpro-tblCk' }, React.createElement('input', { type: 'checkbox', checked: !!selectedIds[m.id], onChange: function () { toggleSel(m.id) } })),
        React.createElement('td', null, m.id),
        React.createElement('td', null, m.name || m.id)
      )
    })
    modelSectionChildren.push(React.createElement('div', { className: 'mpro-tblWrap' },
      React.createElement('table', { className: 'mpro-tbl' },
        React.createElement('thead', null, React.createElement('tr', null,
          React.createElement('th', { className: 'mpro-tblCk' }, ''),
          React.createElement('th', null, t('idCol')),
          React.createElement('th', null, t('nameCol'))
        )),
        React.createElement('tbody', null, mRows)
      )
    ))
  }
  modelSectionChildren.push(inlineStatus)

  var modelsPanel = React.createElement('div', { className: 'mpro-cardBody' }, modelSectionChildren)

  var activePanel = tab === 'info' ? infoPanel : tab === 'headers' ? headersPanel : modelsPanel

  return React.createElement('div', { className: 'mpro-root' },
    React.createElement('div', { className: 'mpro-card' },
      React.createElement('div', { className: 'mpro-editorHead' },
        React.createElement('button', { className: 'mpro-btn', onClick: onBack }, '← ' + t('back')),
        React.createElement('h2', { className: 'mpro-editorRoute' }, data.route),
        data.disabled ? React.createElement('span', { className: 'mpro-tag mpro-tagOff' }, t('disabled')) : null
      ),
      React.createElement('div', { className: 'mpro-tabs' },
        tabBtn('info', t('tabInfo')),
        tabBtn('headers', t('tabHeaders') + (headers.length ? ' (' + headers.length + ')' : '')),
        tabBtn('models', t('tabModels') + (models && models.length ? ' (' + models.length + ')' : ''))
      ),
      activePanel
    )
  )
}

return {
  inject: ['slots', 'locale'],
  apply: function (ctx) {
    var locale = ctx.get('locale') || ctx.locale
    if (locale !== undefined) {
      ctx.effect(function () {
        try { return locale.register(NS, { zh: ZH, en: EN }) } catch (e) { /* namespace already registered from a prior run */ }
      }, 'dsh-model-pro: dictionaries')
    }
    var t = locale !== undefined ? locale.bind(NS) : function (k) { return k }
    styles.insert(CSS)
    var call = async function (method, payload) {
      var r = await host.call(method, payload || {})
      if (r === null || typeof r !== 'object' || r.ok !== true) {
        var msg = function (e) { return typeof e === 'string' ? e : e && typeof e === 'object' && typeof e.message === 'string' ? e.message : '' }
        throw new Error(msg(r && r.error) || t('callFailed'))
      }
      return r
    }
    var slots = ctx.get('slots') || ctx.slots
    if (slots === undefined) return
    slots.inject('settings.section', function () {
      return slots.register(
        { name: 'settings.section', id: 'dsh-model-pro', order: 12, label: function () { return t('nav') } },
        function () { return React.createElement(ModelProPage, { t: t, call: call }) }
      )
    })
  },
}
