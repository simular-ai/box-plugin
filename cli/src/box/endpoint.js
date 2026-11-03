import path from 'node:path'
import { DEFAULT_MCP_URL } from '../constants.js'

/** The relay origin for gRPC, OAuth and the CLI's own token: BOX_ENDPOINT, else the origin of BOX_MCP_URL, else prod. */
export function endpointUrl(env = process.env) {
  const raw = (env.BOX_ENDPOINT || '').trim() || new URL((env.BOX_MCP_URL || '').trim() || DEFAULT_MCP_URL).origin
  const url = new URL(raw)
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))) {
    throw new Error(`the box endpoint must be https (or http on localhost): ${raw}`)
  }
  return url.origin
}

/**
 * Where the CLI keeps its state: BOX_HOME, else ~/.simular-box (0700). It holds the CLI's token (credentials.json, 0600)
 * and offload/, the records of offloads in flight.
 */
export function boxHome(env = process.env, home = env.HOME || env.USERPROFILE) {
  return env.BOX_HOME || path.join(home, '.simular-box')
}
