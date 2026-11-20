// box by Simular for DeepSeek Harness, browser half: the key page on the bundle's Plugins page.
//
// Hand-written in the client module system's lazy-CJS factory format (no build step): running the
// script only registers the factory; the body runs when the page is first used. The key goes
// to dsh's credentials store as BOX_TOKEN through `remote.credentials`, never into settings, and
// the Host half (index.js) restarts the box MCP connection with it.
window.__ModuleLoader__.load({
  id: '@simular/dsh-box',
  factory: (require) => {
    const { jsx, jsxs } = require('react/jsx-runtime')
    const { useCallback, useEffect, useRef, useState } = require('react')
    const { SettingsForm, SettingsSecretField } = require('@deepseek-ai/dsh-client-ui-primitives')

    const PKG = '@simular/dsh-box'
    const NS = 'simular.box'
    const REF = 'BOX_TOKEN'
    const PORTAL = 'https://box.simular.ai'

    const en = {
      token: 'box personal key',
      tokenHint: 'A personal key (cb_...) from your box account. Stored in dsh’s credentials, not in settings. Leave blank to keep the current one.',
      tokenSet: 'Key saved',
      tokenUnset: 'No key yet',
      getToken: 'Create a key on box.simular.ai/keys',
      unavailable: 'Plugin settings are unavailable right now.',
      readOnly: 'This key comes from your environment and can’t be changed here.',
      saveFailed: 'Couldn’t save the key. Try again.',
      save: 'Save',
      saving: 'Saving…',
      liveTitle: 'box · live screen',
      liveFailed: 'Couldn’t show the live screen:',
    }
    const zh = {
      token: 'box 个人 key',
      tokenHint: 'box 账号里的个人 key（cb_ 开头）。保存在 dsh 的密钥里，不写进设置文件。留空则保留当前 key。',
      tokenSet: '已保存',
      tokenUnset: '还没有 key',
      getToken: '在 box.simular.ai/keys 创建 key',
      unavailable: '插件设置暂时不可用。',
      readOnly: '这个 key 来自环境变量，不能在这里修改。',
      saveFailed: 'key 没有保存成功，请再试一次。',
      save: '保存',
      saving: '保存中…',
      liveTitle: 'box · 实时画面',
      liveFailed: '实时画面没能显示：',
    }

    function BoxTokenPage({ ctx, t }) {
      const [text, setText] = useState('')
      const [credential, setCredential] = useState({ configured: false, writable: true })
      const [saving, setSaving] = useState(false)
      const [failed, setFailed] = useState(false)

      const read = useCallback(async () => {
        const response = await ctx.remote.credentials.describe([REF])
        if (!response.ok) return
        const view = response.value[REF]
        setCredential({ configured: view?.configured ?? false, writable: view?.writable ?? true })
      }, [ctx])

      useEffect(() => {
        void read()
        return ctx.remote.$on('credentials/reference-updated', (ref) => {
          if (ref === REF) void read()
        })
      }, [ctx, read])

      const value = text.trim()
      const save = async () => {
        if (!value || saving) return
        setSaving(true)
        setFailed(false)
        try {
          const response = await ctx.remote.credentials.set(REF, value)
          if (!response.ok) throw new Error(response.error?.message)
          setText('')
          await read()
        } catch {
          setFailed(true)
        } finally {
          setSaving(false)
        }
      }

      return jsxs(SettingsForm, {
        labels: {
          unavailable: t('unavailable'),
          readOnly: t('readOnly'),
          saveFailed: t('saveFailed'),
          save: t('save'),
          saving: t('saving'),
        },
        state: {
          available: true,
          writable: credential.writable,
          dirty: value.length > 0,
          invalid: false,
          saving,
          failed,
        },
        onSave: () => void save(),
        onDiscard: () => setText(''),
        children: [
          jsx(SettingsSecretField, {
            id: 'simular-box-token',
            label: t('token'),
            hint: t('tokenHint'),
            disabled: !credential.writable || saving,
            text,
            configured: credential.configured,
            stateLabel: credential.configured ? t('tokenSet') : t('tokenUnset'),
            onEdit: (next) => {
              setText(next)
              setFailed(false)
            },
          }, 'field'),
          jsx('a', {
            href: `${PORTAL}/keys`,
            target: '_blank',
            rel: 'noopener noreferrer',
            children: t('getToken'),
          }, 'link'),
        ],
      })
    }

    // --- Live view: box_view's screen in the chat.
    //
    // box serves its live view as an MCP App (ui://box/live): ChatGPT and Claude render it inline for
    // box_view. dsh has no MCP Apps host, so this card is one, just for that page: it loads the page
    // into a sandboxed iframe (no same-origin, so it cannot reach dsh) and answers the page's
    // MCP Apps requests. The page's tool calls go to the Host half's relay route, which adds the key.

    const VIEW_TOOL = 'mcp__box__box_view'
    // Document-relative, like dsh's own routes: Web serves it from the page's origin, Desktop bridges it.
    const LIVE_ROUTE = 'api/simular-box/live'
    const APPS_PROTOCOL = '2026-01-26'

    async function relay(body) {
      const res = await fetch(LIVE_ROUTE, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(body),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
      return data
    }

    let pagePromise
    function livePage() {
      pagePromise ??= relay({ op: 'page' }).then((data) => data.html).catch((err) => {
        pagePromise = undefined
        throw err
      })
      return pagePromise
    }

    function readArgs(block) {
      const raw = block?.argsRaw ?? block?.call?.argsRaw
      if (typeof raw !== 'string' || !raw) return {}
      try {
        const value = JSON.parse(raw)
        return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
      } catch {
        return {}
      }
    }

    // box mirrors box_view's structuredContent ({ box_id, name, state, view_url }) as JSON in its text
    // block, and dsh keeps the text, so the result for the page is rebuilt from it.
    function readResult(block) {
      const text = (block?.content ?? []).filter((c) => c?.type === 'text').map((c) => c.text).join('\n')
      if (block?.isError) {
        return { isError: true, content: [{ type: 'text', text: text || block?.error?.reason || 'box_view failed' }] }
      }
      let structured
      try {
        structured = JSON.parse(text)
      } catch {}
      if (!structured?.box_id) return { isError: true, content: [{ type: 'text', text: text || 'box_view sent no box' }] }
      return { isError: false, content: [{ type: 'text', text }], structuredContent: structured }
    }

    const isDark = () => {
      const root = document.documentElement
      if (root.dataset.theme === 'dark' || root.classList.contains('dark')) return true
      if (root.dataset.theme === 'light' || root.classList.contains('light')) return false
      return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false
    }

    function LiveView(props) {
      const { phase, block, t } = props
      const frame = useRef(null)
      const state = useRef({ ready: false, args: undefined, result: undefined, sentArgs: false, sentResult: false, nextId: 1 })
      const [html, setHtml] = useState()
      const [failed, setFailed] = useState('')
      const [height, setHeight] = useState(380)
      // The box screen is 16:10 under a 46px bar; the page's own size report can come up a little short.
      const [minHeight, setMinHeight] = useState(0)
      useEffect(() => {
        const el = frame.current
        if (!el || typeof ResizeObserver === 'undefined') return undefined
        const ro = new ResizeObserver(() => setMinHeight(Math.round(el.clientWidth * 0.625) + 70))
        ro.observe(el)
        return () => ro.disconnect()
      }, [html])

      useEffect(() => {
        let live = true
        livePage().then((page) => live && setHtml(page), (err) => live && setFailed(err?.message ?? String(err)))
        return () => {
          live = false
        }
      }, [])

      const post = (message) => frame.current?.contentWindow?.postMessage(message, '*')
      const flush = () => {
        const s = state.current
        if (!s.ready) return
        if (s.args !== undefined && !s.sentArgs) {
          s.sentArgs = true
          post({ jsonrpc: '2.0', method: 'ui/notifications/tool-input', params: { arguments: s.args } })
        }
        if (s.result !== undefined && !s.sentResult) {
          s.sentResult = true
          post({ jsonrpc: '2.0', method: 'ui/notifications/tool-result', params: s.result })
        }
      }

      // Arguments exist from the start phase, the result from the result phase.
      useEffect(() => {
        if (phase === 'preparing') return
        state.current.args ??= readArgs(block)
        if (phase === 'result') state.current.result ??= readResult(block)
        flush()
      }, [phase, block])

      useEffect(() => {
        if (!html) return undefined
        const handle = async (method, params) => {
          switch (method) {
            case 'ui/initialize':
              return {
                protocolVersion: params?.protocolVersion || APPS_PROTOCOL,
                hostInfo: { name: 'DeepSeek Harness (box plugin)', version: '0.3.3' },
                hostCapabilities: { openLinks: {}, serverTools: {} },
                hostContext: {
                  theme: isDark() ? 'dark' : 'light',
                  displayMode: 'inline',
                  availableDisplayModes: ['inline'],
                  platform: 'desktop',
                  toolInfo: { tool: { name: 'box_view', inputSchema: { type: 'object' } } },
                },
              }
            case 'tools/call': {
              const data = await relay({ op: 'tool', name: params?.name, arguments: params?.arguments ?? {} })
              return data.result
            }
            case 'ui/open-link': {
              const url = String(params?.url ?? '')
              if (!/^https:\/\//.test(url)) throw new Error('only https links open')
              window.open(url, '_blank', 'noopener,noreferrer')
              return {}
            }
            case 'ui/request-display-mode':
              return { mode: 'inline' }
            case 'ui/update-model-context':
            case 'ping':
              return {}
            default: {
              const err = new Error(`${method} is not supported here`)
              err.code = -32601
              throw err
            }
          }
        }
        const onMessage = (event) => {
          if (!frame.current || event.source !== frame.current.contentWindow) return
          const m = event.data
          if (!m || m.jsonrpc !== '2.0' || typeof m.method !== 'string') return
          if (m.id === undefined) {
            if (m.method === 'ui/notifications/initialized') {
              state.current.ready = true
              flush()
            } else if (m.method === 'ui/notifications/size-changed') {
              const h = Number(m.params?.height)
              if (Number.isFinite(h) && h > 0) setHeight(Math.min(Math.max(Math.round(h), 220), 900))
            }
            return
          }
          handle(m.method, m.params).then(
            (result) => post({ jsonrpc: '2.0', id: m.id, result: result ?? {} }),
            (err) => post({ jsonrpc: '2.0', id: m.id, error: { code: err?.code ?? -32000, message: err?.message ?? String(err) } }),
          )
        }
        window.addEventListener('message', onMessage)
        return () => {
          window.removeEventListener('message', onMessage)
          post({ jsonrpc: '2.0', id: `teardown-${state.current.nextId++}`, method: 'ui/resource-teardown', params: {} })
        }
      }, [html])

      // The page has its own bar (box name, Live, Take control), so this line shows only before it loads or if it fails.
      const head = jsx('div', { style: { fontSize: 13, opacity: 0.75, margin: '2px 0 6px' }, children: t('liveTitle') })
      if (failed) {
        return jsxs('div', { children: [head, jsx('div', { style: { fontSize: 13, opacity: 0.7 }, children: `${t('liveFailed')} ${failed}` }, 'err')] })
      }
      if (phase === 'preparing' || !html) return jsxs('div', { children: [head] })
      return jsxs('div', {
        children: [
          jsx('iframe', {
            ref: frame,
            title: t('liveTitle'),
            srcDoc: html,
            // No allow-same-origin: the page gets an opaque origin and cannot touch dsh.
            sandbox: 'allow-scripts allow-popups allow-popups-to-escape-sandbox',
            scrolling: 'no',
            style: { display: 'block', width: '100%', height: Math.max(height, minHeight), border: 0, borderRadius: 12, background: 'transparent' },
          }, 'frame'),
        ],
      })
    }

    // --- The same view beneath a finished turn.
    //
    // dsh folds a finished turn's tool calls, the card above with them. Like dsh's own created-task
    // card, a turn definition collects the turn's settled box_view results and the turn tail, which
    // stays open, shows the last one.

    const TURN_KEY = 'simular-box-view'

    const turnDefinition = {
      kind: TURN_KEY,
      match: (event) => {
        if (event.type === 'turn/start') return { id: String(event.data.turn), role: 'start' }
        if (event.type === 'tool/call') return { id: String(event.data.turn), role: 'update' }
        if (event.type === 'tool/result' && event.surfaceOp === 'append') return { id: String(event.data.turn), role: 'update' }
        return null
      },
      start: (_context, match) => ({ turn: match.event.data.turn, calls: new Map(), views: [] }),
      update: (context, match) => {
        const event = match.event
        const state = context.state
        if (event.type === 'tool/call') {
          if (event.data.name !== VIEW_TOOL) return state
          const calls = new Map(state.calls)
          calls.set(String(event.data.callId), { argsRaw: event.data.arguments, time: event.time })
          return { ...state, calls }
        }
        if (event.type !== 'tool/result') return state
        const callId = String(event.data.message.source.callId)
        const call = state.calls.get(callId)
        if (!call || state.views.some((view) => view.callId === callId)) return state
        const node = {
          kind: 'tool-result',
          seq: event.seq,
          time: event.time,
          callId,
          name: VIEW_TOOL,
          call: { name: VIEW_TOOL, argsRaw: call.argsRaw },
          callTime: call.time,
          content: event.data.message.content,
          isError: event.data.message.isError === true,
          subCalls: [],
        }
        return { ...state, views: [...state.views, node] }
      },
      buildLocationData: (context, scope, previous) => {
        if (scope !== 'turn' || context.state === undefined) return null
        if (previous?.kind === 'turn' && previous.turn === context.state.turn && previous.key === TURN_KEY
          && previous.value.views === context.state.views) return previous
        return { kind: 'turn', turn: context.state.turn, key: TURN_KEY, value: { views: context.state.views } }
      },
    }

    function LiveTail(props) {
      const views = props.turn?.data?.get(TURN_KEY)?.views ?? []
      const end = props.turn?.end?.seq ?? props.seq
      const last = views.filter((view) => view.seq <= end).at(-1)
      if (!last || last.isError) return null
      return jsx(LiveView, { phase: 'result', block: last, t: props.t }, last.callId)
    }

    const inject = ['slots', 'locale', 'remote', 'remote.credentials']

    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, { en, zh }), 'dsh-box: dictionaries')
      ctx.effect(() => ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register({
        name: 'plugins.bundle.config',
        key: PKG,
        locale: NS,
      }, ({ t, view }) => (view === 'summary' ? t('token') : jsx(BoxTokenPage, { ctx, t })))), 'dsh-box: token page')
      ctx.effect(() => ctx.slots.inject('tool.call.toolview', () => ctx.slots.register({
        name: 'tool.call.toolview',
        key: VIEW_TOOL,
        locale: NS,
      }, LiveView)), 'dsh-box: live view card')
      // Optional: a client without the conversation service still gets the key page and the card.
      ctx.inject(['uiConversation'], (scope) => {
        scope.effect(() => scope.uiConversation.events.register(turnDefinition), 'dsh-box: live view turn data')
        scope.effect(() => scope.slots.inject('conversation.chat.turnTail', () => scope.slots.register({
          name: 'conversation.chat.turnTail',
          id: `${PKG}/live-view`,
          order: 10,
          locale: NS,
        }, LiveTail)), 'dsh-box: live view beneath the turn')
      })
    }

    return { apply, inject }
  },
})
