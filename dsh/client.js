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
    const { useCallback, useEffect, useState } = require('react')
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

    const inject = ['slots', 'locale', 'remote', 'remote.credentials']

    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, { en, zh }), 'dsh-box: dictionaries')
      ctx.effect(() => ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register({
        name: 'plugins.bundle.config',
        key: PKG,
        locale: NS,
      }, ({ t, view }) => (view === 'summary' ? t('token') : jsx(BoxTokenPage, { ctx, t })))), 'dsh-box: token page')
    }

    return { apply, inject }
  },
})
