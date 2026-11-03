/**
 * box by Simular for DeepSeek Harness, Host half.
 *
 * dsh's MCP client sends fixed headers and has no sign-in, so box authenticates with a personal
 * key (cb_...). This plugin reads it from dsh's credentials store under BOX_TOKEN (which also
 * falls back to the launch environment and ~/.dsh/.env) and provides it as the `boxAuth` service.
 * The `mcp-box` row injects `boxAuth`, so it starts once a key exists and restarts with the new
 * header whenever the key changes. The browser half (client.js) is the key page on Plugins.
 */
export const name = '@simular/dsh-box'
export const inject = ['credentials']

const REF = 'BOX_TOKEN'

export function apply(ctx) {
  let unprovide
  let generation = 0
  const refresh = async () => {
    const mine = ++generation
    const hit = await ctx.credentials.resolve(REF)
    if (mine !== generation) return
    unprovide?.()
    unprovide = undefined
    const token = hit?.value?.trim()
    if (token) unprovide = ctx.provide('boxAuth', { authorization: `Bearer ${token}` })
  }
  // Log why the key couldn't be read (never the key itself); otherwise mcp-box just waits on
  // boxAuth with no reason shown.
  const refreshLogged = () =>
    refresh().catch((err) => ctx.logger?.warn('box: could not read BOX_TOKEN', err?.message))
  ctx.on('credentials/reference-updated', (ref) => {
    if (ref === REF) void refreshLogged()
  })
  void refreshLogged()
}
