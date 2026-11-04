import { spawn as nodeSpawn } from 'node:child_process'

// openBrowser opens one http(s) URL in this computer's browser without any shell: the URL may come from a box's output,
// so a shell metacharacter in it (& | ^ % on Windows' cmd) must never be interpreted. Each platform's opener takes the
// URL as one argv element: macOS open(1), xdg-open (which passes "$1" quoted), and on Windows rundll32's
// url.dll,FileProtocolHandler, the shell-free opener behind ShellExecute. BROWSER, when set, is run the same way.

/** browserCommand is the opener and its argv for url, or null when url is no http(s) URL. */
export function browserCommand(url, { env = process.env, platform = process.platform } = {}) {
  let href
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null
    href = parsed.href
  } catch {
    return null
  }
  if (env.BROWSER) return [env.BROWSER, [href]]
  if (platform === 'darwin') return ['open', [href]]
  if (platform === 'win32') return ['rundll32', ['url.dll,FileProtocolHandler', href]]
  return ['xdg-open', [href]]
}

export function openBrowser(url, { env = process.env, platform = process.platform, spawn = nodeSpawn } = {}) {
  const command = browserCommand(url, { env, platform })
  if (!command) return false
  try {
    // shell: false is the default; it is spelled out because the URL must never reach a shell
    spawn(command[0], command[1], { stdio: 'ignore', detached: true, shell: false, windowsVerbatimArguments: false }).on('error', () => {}).unref()
    return true
  } catch {
    return false // the URL is printed too
  }
}
