/**
 * dsh-my-workspace host half.
 *
 * Feature 1 — workspace quick actions: open the current session's project
 * root directory in any launcher available on this machine, or hand its path
 * to the browser clipboard.
 *
 * This half owns three concerns:
 *
 *   1. Launcher detection — probe the machine's PATH (and well-known app
 *      wrappers) for editors/IDEs, terminal emulators, and file managers,
 *      producing the "available targets" list the UI renders.
 *   2. Opening — spawn the chosen launcher detached (stdio ignored, unref'd)
 *      so this web process never holds pipes to it. Paths are validated
 *      (absolute, existing, a directory) and no shell is involved: the
 *      launcher is spawned as [binary, ...args].
 *   3. Preferences — persist the user's default launcher in
 *      $DSH_HOME/dsh-my-workspace/settings.json.
 *
 *   GET  /dsh-my-workspace/state    -> { platform, targets:[{id,kind,label,
 *                                      available,bin}], settings }
 *   POST /dsh-my-workspace/open     -> body { target, path } ; spawns detached
 *   POST /dsh-my-workspace/settings -> body { defaultTarget } ; persists
 *
 * Routes are guarded by the same fail-closed same-origin/localhost trust
 * check as dsh-restart / dsh-trader: a cross-origin or malformed
 * Origin/Referer rejects, a CORS-simple content type rejects, and only then
 * does a localhost Host count as trusted.
 */
import { homedir } from 'node:os'
import { join, dirname, isAbsolute, resolve, delimiter } from 'node:path'
import { pathToFileURL } from 'node:url'
import { stat } from 'node:fs/promises'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { spawn } from 'node:child_process'

export const name = 'my-workspace'

/** Host services required before mounting. */
export const inject = ['webServer']

/** Test seams: injected spawn / stat / platform / PATH for every probe. */
let internals = {}
export function _setInternals(value) {
  internals = value || {}
}
export function _resetInternals() {
  internals = {}
}

function spawnFn() {
  return internals.spawn ?? spawn
}
function statFn() {
  return internals.stat ?? stat
}
function platform() {
  return internals.platform ?? process.platform
}

// ---------------------------------------------------------------------------
// Launcher catalog
// ---------------------------------------------------------------------------

/**
 * Every launcher this plugin knows, grouped and ordered. Each entry:
 *
 *   id       stable identifier used by routes/settings
 *   group    'ide' | 'terminal' | 'files' (menu section + icon)
 *   label    display name (the client localizes nothing here — product names)
 *   bins     candidate executable names probed on PATH, first hit wins
 *   args     (dir) => argument list AFTER the program
 *
 * A missing `bins` means the entry is only reachable through its own
 * `darwinOnly`/platform gate below (osascript wrappers).
 */
export const CATALOG = [
  // ---- Editors & IDEs -----------------------------------------------------
  { id: 'vscode', group: 'ide', label: 'VS Code', bins: ['code'], args: (p) => [p] },
  { id: 'vscode-insiders', group: 'ide', label: 'VS Code Insiders', bins: ['code-insiders'], args: (p) => [p] },
  { id: 'vscodium', group: 'ide', label: 'VSCodium', bins: ['codium'], args: (p) => [p] },
  { id: 'cursor', group: 'ide', label: 'Cursor', bins: ['cursor'], args: (p) => [p] },
  { id: 'windsurf', group: 'ide', label: 'Windsurf', bins: ['windsurf'], args: (p) => [p] },
  { id: 'zed', group: 'ide', label: 'Zed', bins: ['zed'], args: (p) => [p] },
  { id: 'idea', group: 'ide', label: 'IntelliJ IDEA', bins: ['idea'], args: (p) => [p] },
  { id: 'pycharm', group: 'ide', label: 'PyCharm', bins: ['pycharm'], args: (p) => [p] },
  { id: 'webstorm', group: 'ide', label: 'WebStorm', bins: ['webstorm'], args: (p) => [p] },
  { id: 'clion', group: 'ide', label: 'CLion', bins: ['clion'], args: (p) => [p] },
  { id: 'goland', group: 'ide', label: 'GoLand', bins: ['goland'], args: (p) => [p] },
  { id: 'rider', group: 'ide', label: 'Rider', bins: ['rider'], args: (p) => [p] },
  { id: 'phpstorm', group: 'ide', label: 'PhpStorm', bins: ['phpstorm'], args: (p) => [p] },
  { id: 'rubymine', group: 'ide', label: 'RubyMine', bins: ['rubymine'], args: (p) => [p] },
  { id: 'datagrip', group: 'ide', label: 'DataGrip', bins: ['datagrip'], args: (p) => [p] },
  { id: 'fleet', group: 'ide', label: 'Fleet', bins: ['fleet'], args: (p) => [p] },

  // AI-era editors (probed like everything else — absent = invisible):
  // Google Antigravity, Trae, Kiro, Void, and the community-named picks.
  { id: 'antigravity', group: 'ide', label: 'Antigravity', bins: ['antigravity'], args: (p) => [p] },
  { id: 'zcode', group: 'ide', label: 'ZCode', bins: ['zcode'], args: (p) => [p] },
  { id: 'berd', group: 'ide', label: 'Berd', bins: ['berd'], args: (p) => [p] },
  { id: 'orca', group: 'ide', label: 'Orca', bins: ['orca'], args: (p) => [p] },
  { id: 'trae', group: 'ide', label: 'Trae', bins: ['trae'], args: (p) => [p] },
  { id: 'kiro', group: 'ide', label: 'Kiro', bins: ['kiro'], args: (p) => [p] },
  { id: 'void', group: 'ide', label: 'Void', bins: ['void'], args: (p) => [p] },
  { id: 'sublime', group: 'ide', label: 'Sublime Text', bins: ['subl'], args: (p) => [p] },

  // ---- Terminal emulators -------------------------------------------------
  ...terminalEntries(),

  // Warp ships no reliable "open at path" flag on every platform, so it
  // launches plain and inherits the directory as the child cwd instead.
  { id: 'warp', group: 'terminal', label: 'Warp', bins: ['warp'], args: () => [], cwdBased: true },

  // ---- File managers ------------------------------------------------------
  { id: 'xdg-open', group: 'files', linuxOnly: true, label: 'Files', bins: ['xdg-open'], args: (p) => [p] },
  { id: 'nautilus', group: 'files', linuxOnly: true, label: 'Nautilus', bins: ['nautilus'], args: (p) => [p] },
  { id: 'dolphin', group: 'files', linuxOnly: true, label: 'Dolphin', bins: ['dolphin'], args: (p) => [p] },
  { id: 'finder', group: 'files', darwinOnly: true, label: 'Finder', bins: ['open'], args: (p) => [p] },
  { id: 'explorer', group: 'files', winOnly: true, label: 'Explorer', bins: ['explorer'], args: (p) => [p] },
]

/**
 * Terminal entries for the current OS family. On macOS the Terminal.app and
 * iTerm launches go through osascript (no CLI binary takes a working dir),
 * so their `args` embed an escaped `cd` script; the detected "binary" is
 * osascript itself. Linux/Windows terminals take the directory directly.
 */
function terminalEntries() {
  if (platform() === 'darwin') {
    const cdScript = (app, p) => [
      '-e',
      'tell application "' + app + '" to activate\n' +
      'tell application "' + app + '" to do script "cd ' + appleQuote(p) + '"',
    ]
    return [
      { id: 'apple-terminal', group: 'terminal', darwinOnly: true, label: 'Terminal', bins: ['osascript'], args: (p) => cdScript('Terminal', p) },
      { id: 'iterm2', group: 'terminal', darwinOnly: true, label: 'iTerm', bins: ['osascript'], args: (p) => cdScript('iTerm', p) },
    ]
  }
  if (platform() === 'win32') {
    return [
      { id: 'windows-terminal', group: 'terminal', winOnly: true, label: 'Windows Terminal', bins: ['wt'], args: (p) => ['-d', p] },
      { id: 'powershell', group: 'terminal', winOnly: true, label: 'PowerShell', bins: ['powershell'], args: () => [] , cwdBased: true },
    ]
  }
  return [
    { id: 'gnome-terminal', group: 'terminal', linuxOnly: true, label: 'GNOME Terminal', bins: ['gnome-terminal'], args: (p) => ['--working-directory=' + p] },
    { id: 'konsole', group: 'terminal', linuxOnly: true, label: 'Konsole', bins: ['konsole'], args: (p) => ['--workdir', p] },
    { id: 'xfce4-terminal', group: 'terminal', linuxOnly: true, label: 'Xfce Terminal', bins: ['xfce4-terminal'], args: (p) => ['--working-directory=' + p] },
    { id: 'tilix', group: 'terminal', linuxOnly: true, label: 'Tilix', bins: ['tilix'], args: (p) => ['-w', p] },
    { id: 'alacritty', group: 'terminal', linuxOnly: true, label: 'Alacritty', bins: ['alacritty'], args: (p) => ['--working-directory', p] },
    { id: 'kitty', group: 'terminal', linuxOnly: true, label: 'kitty', bins: ['kitty'], args: (p) => ['--directory', p] },
    { id: 'wezterm', group: 'terminal', linuxOnly: true, label: 'WezTerm', bins: ['wezterm'], args: (p) => ['start', '--cwd', p] },
    { id: 'ghostty', group: 'terminal', linuxOnly: true, label: 'Ghostty', bins: ['ghostty'], args: (p) => ['--working-directory=' + p] },
  ]
}

/**
 * Escape a path for embedding inside an AppleScript double-quoted string:
 * backslashes and double quotes get a backslash. Paths reaching this far
 * have already been validated by normalizeTargetPath.
 */
export function appleQuote(p) {
  return String(p).replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

const DETECT_TTL_MS = 10_000
let detectCache = { at: 0, targets: null }

/** Candidate executable names for one entry on this platform. */
function binCandidates(entry) {
  if (platform() !== 'win32') return entry.bins
  const exts = ['exe', 'cmd', 'bat']
  const out = []
  for (const bin of entry.bins) {
    out.push(bin)
    for (const ext of exts) out.push(bin + '.' + ext)
  }
  return out
}

/** Whether a catalog entry applies to the running platform. */
export function entryApplies(entry) {
  const p = platform()
  if (entry.linuxOnly) return p === 'linux'
  if (entry.darwinOnly) return p === 'darwin'
  if (entry.winOnly) return p === 'win32'
  return true
}

/**
 * Probe the PATH for one executable name; the absolute path when found.
 */
async function findOnPath(bin) {
  const pathEnv = internals.pathEnv ?? process.env.PATH ?? ''
  const dirs = pathEnv.split(delimiter).filter((d) => d !== '')
  for (const dir of dirs) {
    const full = join(dir, bin)
    try {
      // stat follows symlinks, so a launcher (file or symlink to one) isFile()s.
      const st = await statFn()(full)
      if (!st.isFile()) continue
      return full
    } catch { /* not here */ }
  }
  return null
}

/** Catalog entries visible on this platform, availability probed. */
export async function detectTargets() {
  const cached = detectCache.targets
  if (cached !== null && Date.now() - detectCache.at < DETECT_TTL_MS) return cached
  const targets = []
  for (const entry of CATALOG) {
    if (!entryApplies(entry)) continue
    let bin = null
    for (const candidate of binCandidates(entry)) {
      bin = await findOnPath(candidate)
      if (bin !== null) break
    }
    targets.push({
      id: entry.id,
      group: entry.group,
      label: entry.label,
      available: bin !== null,
      bin,
    })
  }
  detectCache = { at: Date.now(), targets }
  return targets
}

/** Invalidate the detection memo (tests, explicit refresh). */
export function resetDetectCache() {
  detectCache = { at: 0, targets: null }
}

/** One catalog entry by id, or undefined. */
export function catalogEntry(id) {
  return CATALOG.find((entry) => entry.id === id)
}

// ---------------------------------------------------------------------------
// Path validation & launching
// ---------------------------------------------------------------------------

/**
 * Validate a client-supplied path: absolute, bounded length, no NUL,
 * resolvable. Returns the resolved absolute path or null. Both directories
 * and files are legal open targets — nested as deep as they exist.
 */
export function normalizeTargetPath(raw) {
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim()
  if (trimmed === '' || trimmed.length > 4096 || trimmed.includes('\0')) return null
  if (!isAbsolute(trimmed)) return null
  return resolve(trimmed)
}

/** Stat the path into 'dir' | 'file'; rejects when it does not exist. */
export async function pathKind(path) {
  const st = await statFn()(path)
  return st.isDirectory() ? 'dir' : 'file'
}

/** Terminals can only sit IN a directory: a file opens its parent instead. */
export function terminalDirFor(path, kind) {
  return kind === 'dir' ? path : dirname(path)
}

/**
 * Native "reveal this file" argv for platforms whose file-manager entry owns
 * the verb; null elsewhere (Linux goes through the freedesktop DBus probe in
 * showItemsArgv, falling back to opening the parent directory).
 */
export function fileRevealFor(platformName, path) {
  if (platformName === 'darwin') return { bin: 'open', args: ['-R', path] }
  if (platformName === 'win32') return { bin: 'explorer', args: ['/select,' + path] }
  return null
}

/**
 * org.freedesktop.FileManager1.ShowItems argv for the given CLI tool —
 * the standard reveal-and-select verb Nautilus, Dolphin, Nemo et al. carry.
 */
export function showItemsArgv(tool, fileUrl) {
  if (tool === 'gdbus') {
    return [
      'call', '--session',
      '--dest', 'org.freedesktop.FileManager1',
      '--object-path', '/org/freedesktop/FileManager1',
      '--method', 'org.freedesktop.FileManager1.ShowItems',
      '[' + JSON.stringify(fileUrl) + ']',
      '',
    ]
  }
  if (tool === 'dbus-send') {
    return [
      '--session',
      '--dest=org.freedesktop.FileManager1',
      '--type=method_call',
      '/org/freedesktop/FileManager1',
      'org.freedesktop.FileManager1.ShowItems',
      'array:string:' + fileUrl,
      'string:',
    ]
  }
  return null
}

/**
 * Spawn a launcher detached so this process never waits on it: stdio
 * ignored, child unref'd. ENOENT-style failures surface through the child's
 * 'error' event within a short settle window; after that the fire-and-forget
 * launch counts as handed off. Resolves { ok } or { ok:false, error }.
 */
export function launch(bin, args, cwd) {
  return new Promise((resolvePromise) => {
    let settled = false
    const done = (value) => {
      if (settled) return
      settled = true
      resolvePromise(value)
    }
    try {
      const options = { detached: true, stdio: 'ignore', env: process.env }
      if (cwd) options.cwd = cwd
      const child = spawnFn()(bin, args, options)
      child.once?.('error', (error) => done({ ok: false, error: String(error && error.message ? error.message : error) }))
      child.unref?.()
    } catch (error) {
      done({ ok: false, error: String(error && error.message ? error.message : error) })
      return
    }
    const settleMs = internals.launchSettleMs ?? 80
    setTimeout(() => done({ ok: true }), settleMs)
  })
}

// ---------------------------------------------------------------------------
// Shared open core — one implementation for the HTTP route and the model tool
// ---------------------------------------------------------------------------

/**
 * Open any existing absolute path — project root, a directory nested many
 * levels deep, or an individual file — in one launcher, adapting to what the
 * launcher can actually do:
 *
 *   - IDE / editor: receives the exact path (file or directory).
 *   - Terminal:      sits in the nearest directory (a file opens its parent).
 *   - File manager:  opens directories; for files it reveals/selects them —
 *                    `open -R` on macOS, `explorer /select,` on Windows, and
 *                    org.freedesktop.FileManager1.ShowItems over gdbus or
 *                    dbus-send on Linux, falling back to the parent directory.
 *
 * Resolves { ok, code, target, path, kind, revealed?, error? }.
 */
export async function openWithPath(targetId, rawPath) {
  const entry = catalogEntry(targetId)
  if (!entry || !entryApplies(entry)) {
    return { ok: false, code: 400, target: targetId, error: 'unknown target: ' + targetId }
  }
  const path = normalizeTargetPath(rawPath)
  if (path === null) {
    return { ok: false, code: 400, target: targetId, error: 'path must be an absolute file or directory path' }
  }
  let kind
  try {
    kind = await pathKind(path)
  } catch {
    return { ok: false, code: 400, target: targetId, path, error: 'no such file or directory: ' + path }
  }
  const detected = (await detectTargets()).find((t) => t.id === targetId)
  if (!detected || !detected.available || !detected.bin) {
    return { ok: false, code: 400, target: targetId, path, kind, error: 'launcher not available: ' + entry.label }
  }

  let bin = detected.bin
  let args = entry.args(path)
  let cwd = entry.cwdBased ? path : undefined

  if (entry.group === 'terminal') {
    const dir = terminalDirFor(path, kind)
    args = entry.cwdBased ? [] : entry.args(dir)
    cwd = entry.cwdBased ? dir : undefined
  } else if (entry.group === 'files' && kind === 'file') {
    const native = fileRevealFor(platform(), path)
    if (native) {
      // The reveal verb belongs to the same binary this entry already probed.
      args = native.args
    } else {
      let revealedViaDbus = false
      for (const tool of ['gdbus', 'dbus-send']) {
        const argv = showItemsArgv(tool, pathToFileURL(path).href)
        const toolBin = await findOnPath(tool)
        if (!argv || !toolBin) continue
        const dbusResult = await launch(toolBin, argv)
        return {
          ok: dbusResult.ok,
          code: dbusResult.ok ? 200 : 500,
          target: targetId,
          path,
          kind,
          revealed: true,
          via: tool,
          error: dbusResult.error,
        }
      }
      if (!revealedViaDbus) {
        const dir = dirname(path)
        args = entry.args(dir)
      }
    }
  }

  const result = await launch(bin, args, cwd)
  return {
    ok: result.ok,
    code: result.ok ? 200 : 500,
    target: targetId,
    path,
    kind,
    revealed: entry.group === 'files' && kind === 'file',
    error: result.error,
  }
}

/** First available launcher id: the stored default, else the first IDE, else any. */
export async function resolveDefaultTarget() {
  const stored = defaultTargetId()
  if (stored) return stored
  const targets = await detectTargets()
  const firstIde = targets.find((t) => t.available && t.group === 'ide')
  const firstAny = targets.find((t) => t.available)
  return (firstIde || firstAny || {}).id ?? null
}

// ---------------------------------------------------------------------------
// Settings ($DSH_HOME/dsh-my-workspace/settings.json)
// ---------------------------------------------------------------------------

/** Absolute path of the settings file. */
export function settingsPath() {
  const env = process.env.DSH_HOME
  const home = typeof env === 'string' && env.trim() !== '' ? env : join(homedir(), '.dsh')
  return join(home, 'dsh-my-workspace', 'settings.json')
}

/** Read persisted preferences; corrupted files fall back to defaults. */
export function readSettings() {
  try {
    const raw = JSON.parse(readFileSync(settingsPath(), 'utf8'))
    return raw && typeof raw === 'object' ? raw : {}
  } catch { /* missing or damaged */ }
  return {}
}

/** Persist preferences atomically enough for a two-key file (0600). */
export function writeSettings(next) {
  mkdirSync(dirname(settingsPath()), { recursive: true })
  writeFileSync(settingsPath(), JSON.stringify(next, null, 2) + '\n', { mode: 0o600 })
  return next
}

/** The stored default launcher id, or null when unset/unknown. */
export function defaultTargetId() {
  const id = readSettings().defaultTarget
  return typeof id === 'string' && catalogEntry(id) ? id : null
}

// ---------------------------------------------------------------------------
// HTTP helpers (trust check mirroring dsh-restart / dsh-trader)
// ---------------------------------------------------------------------------

function headerHost(value) {
  try {
    return new URL(value).host
  } catch {
    return null
  }
}

function simpleContentType(value) {
  if (typeof value !== 'string' || value === '') return false
  const type = value.split(';')[0].trim().toLowerCase()
  return type === 'text/plain' || type === 'application/x-www-form-urlencoded' || type === 'multipart/form-data'
}

export function isTrustedRequest(req) {
  const headers = req.headers ?? {}
  const host = headers.host ?? ''
  for (const header of [headers.origin, headers.referer]) {
    if (header === undefined || header === null || header === '') continue
    if (header === 'null') return false
    const sourceHost = headerHost(header)
    if (sourceHost === null || sourceHost !== host) return false
  }
  if (simpleContentType(headers['content-type'])) return false
  return host.startsWith('127.0.0.1') || host.startsWith('localhost') || host.startsWith('::1')
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > 16 * 1024) {
        reject(new Error('body too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8')
        resolve(raw === '' ? {} : JSON.parse(raw))
      } catch (error) {
        reject(error)
      }
    })
    req.on('error', reject)
  })
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  })
  res.end(body)
}

function errorMessage(error) {
  return String(error && error.message ? error.message : error)
}

// ---------------------------------------------------------------------------
// Plugin entry
// ---------------------------------------------------------------------------

export async function apply(ctx) {
  // Optional registry of the GUI's durable workspaces (id/title/canonical
  // path). Absent in stripped-down hosts — the sidebar feature degrades to
  // "not found" rather than blocking the session-header actions.
  const workspaces = ctx.get('workspaceRegistry')

  // GET /dsh-my-workspace/workspaces — id/title/path leaf fields only.
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/dsh-my-workspace/workspaces',
    handler: async (req, res) => {
      if (req.method !== 'GET') return sendJson(res, 405, { error: 'method not allowed' })
      if (!isTrustedRequest(req)) return sendJson(res, 403, { error: 'untrusted request' })
      try {
        const list = workspaces && typeof workspaces.list === 'function' ? workspaces.list() : []
        const items = []
        for (const entry of list) {
          if (!entry || typeof entry.path !== 'string' || entry.path === '') continue
          items.push({
            id: typeof entry.id === 'string' || typeof entry.id === 'number' ? String(entry.id) : null,
            title: typeof entry.title === 'string' ? entry.title : '',
            path: entry.path,
          })
        }
        items.sort((a, b) => a.title.localeCompare(b.title))
        sendJson(res, 200, { workspaces: items })
      } catch (error) {
        sendJson(res, 500, { error: errorMessage(error) })
      }
    },
  }), 'dsh-my-workspace: /dsh-my-workspace/workspaces route')

  // GET /dsh-my-workspace/state — platform, detected launchers, preferences.
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/dsh-my-workspace/state',
    handler: async (req, res) => {
      if (req.method !== 'GET') return sendJson(res, 405, { error: 'method not allowed' })
      if (!isTrustedRequest(req)) return sendJson(res, 403, { error: 'untrusted request' })
      try {
        sendJson(res, 200, {
          platform: platform(),
          targets: await detectTargets(),
          settings: { defaultTarget: defaultTargetId() },
        })
      } catch (error) {
        sendJson(res, 500, { error: errorMessage(error) })
      }
    },
  }), 'dsh-my-workspace: /dsh-my-workspace/state route')

  // POST /dsh-my-workspace/settings — persist the default launcher id.
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/dsh-my-workspace/settings',
    handler: async (req, res) => {
      if (req.method !== 'POST') return sendJson(res, 405, { error: 'method not allowed' })
      if (!isTrustedRequest(req)) return sendJson(res, 403, { error: 'untrusted request' })
      const body = await readJsonBody(req).catch(() => null)
      const id = body && typeof body.defaultTarget === 'string' ? body.defaultTarget : null
      if (id !== null && !catalogEntry(id)) {
        return sendJson(res, 400, { ok: false, error: 'unknown target: ' + id })
      }
      try {
        writeSettings({ ...readSettings(), defaultTarget: id })
        sendJson(res, 200, { ok: true, settings: { defaultTarget: defaultTargetId() } })
      } catch (error) {
        sendJson(res, 500, { ok: false, error: errorMessage(error) })
      }
    },
  }), 'dsh-my-workspace: /dsh-my-workspace/settings route')

  // POST /dsh-my-workspace/open — validate + detach-spawn one launcher.
  // Accepts any existing absolute path: the project root, directories nested
  // any number of levels down, or individual files.
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/dsh-my-workspace/open',
    handler: async (req, res) => {
      if (req.method !== 'POST') return sendJson(res, 405, { error: 'method not allowed' })
      if (!isTrustedRequest(req)) return sendJson(res, 403, { error: 'untrusted request' })
      const body = await readJsonBody(req).catch(() => null)
      const targetId = body && typeof body.target === 'string' ? body.target : ''
      const result = await openWithPath(targetId, body && body.path)
      sendJson(res, result.code, result)
    },
  }), 'dsh-my-workspace: /dsh-my-workspace/open route')

  // workspace_open — model tool so an agent session can pop the project
  // root, any nested directory, or a single file into the user's IDE,
  // terminal, or file manager on request. Shares openWithPath with the HTTP
  // surface; optional service — absent in stripped hosts, tool simply not
  // registered.
  const tools = ctx.get('tools')
  if (tools && typeof tools.register === 'function') {
    ctx.effect(() => tools.register({
      name: 'workspace_open',
      description: [
        'Open a path from the current project on the user\'s desktop: the project root, a subdirectory nested any number of levels deep, or an individual file.',
        'Launchers are auto-detected on this machine — editors/IDEs (VS Code, Cursor, JetBrains IDEs, Antigravity, Zed, ...), terminals, and file managers.',
        'Semantics per kind: files and directories open exactly in editors; terminals sit in the nearest directory (a file opens its parent); file managers reveal/select files where the platform supports it.',
        'Omit target to use the user\'s default opener (Settings → Workspace), falling back to the first detected IDE. Use this whenever the user asks to "open X in <tool>" instead of shelling out yourself.',
      ].join(' '),
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['path'],
        properties: {
          path: { type: 'string', description: 'Absolute path to open: the workspace root, any nested directory, or a file.' },
          target: { type: 'string', description: 'Optional launcher id (e.g. "vscode", "cursor", "gnome-terminal", "nautilus"). Omit for the default opener.' },
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          required: ['ok', 'text'],
          properties: {
            ok: { type: 'boolean' },
            text: { type: 'string' },
          },
        },
        render: (_args, value) => [{ type: 'text', text: value.text }],
      },
      async execute(args) {
        let targetId = args && typeof args.target === 'string' && args.target !== '' ? args.target : null
        if (targetId === null) {
          targetId = await resolveDefaultTarget()
          if (!targetId) return { ok: false, text: 'No supported launcher was found on this machine.' }
        }
        const result = await openWithPath(targetId, args && args.path)
        const lines = result.ok ? ['Opened ' + result.path + ' (' + result.kind + ') in ' + result.target] : ['Failed to open ' + String(args && args.path) + ': ' + (result.error || 'unknown error')]
        if (result.revealed) lines.push('File manager revealed/selects the file' + (result.via ? ' via ' + result.via + '.' : '.'))
        else lines.push('kind=' + result.kind + ', revealed=false')
        lines.push('target=' + result.target)
        return { ok: !!result.ok, text: lines.join('\n') }
      },
    }), 'dsh-my-workspace: workspace_open tool')
  }

  console.log('[dsh-my-workspace] host routes ready')
}
