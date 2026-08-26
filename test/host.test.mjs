// Host-half tests for dsh-my-workspace: launcher detection against a fake
// PATH, path validation, AppleScript quoting, platform gating, and every
// route (spawn is stubbed so no real launcher starts; trust guard included).
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'

const tmp = mkdtempSync(join(tmpdir(), 'dsh-my-workspace-test-'))
process.env.DSH_HOME = tmp

const mod = await import('../lib/index.js')

// ---------------------------------------------------------------------------
// Path validation
// ---------------------------------------------------------------------------
{
  assert.equal(mod.normalizeTargetPath('/tmp'), '/tmp')
  assert.equal(mod.normalizeTargetPath('/tmp/../var'), '/var')
  assert.equal(mod.normalizeTargetPath('rel/path'), null)
  assert.equal(mod.normalizeTargetPath(''), null)
  assert.equal(mod.normalizeTargetPath('   '), null)
  assert.equal(mod.normalizeTargetPath(null), null)
  assert.equal(mod.normalizeTargetPath(42), null)
  assert.equal(mod.normalizeTargetPath('a\0b'), null)
  assert.equal(mod.normalizeTargetPath('/' + 'x'.repeat(5000)), null)

  // kind detection over real fs entries
  const probeFile = join(tmp, 'probe.txt')
  writeFileSync(probeFile, 'x\n')
  assert.equal(await mod.pathKind(tmp), 'dir')
  assert.equal(await mod.pathKind(probeFile), 'file')
  await assert.rejects(() => mod.pathKind(join(tmp, 'nope')), 'missing paths reject')

  // terminals always sit in a directory
  assert.equal(mod.terminalDirFor('/a/b/c.js', 'file'), '/a/b')
  assert.equal(mod.terminalDirFor('/a/b', 'dir'), '/a/b')

  // native reveal verbs
  assert.deepEqual(mod.fileRevealFor('darwin', '/a/f.txt').args, ['-R', '/a/f.txt'])
  assert.deepEqual(mod.fileRevealFor('win32', 'C:\\a\\f.txt').args, ['/select,C:\\a\\f.txt'])
  assert.equal(mod.fileRevealFor('linux', '/a/f.txt'), null, 'linux goes through the freedesktop DBus probe')

  // org.freedesktop.FileManager1.ShowItems argv shapes
  const g = mod.showItemsArgv('gdbus', 'file:///a/f.txt')
  assert.equal(g[0], 'call')
  assert.ok(g.includes('org.freedesktop.FileManager1.ShowItems'))
  assert.equal(g[g.length - 2], '["file:///a/f.txt"]', 'GVariant array of URIs')
  assert.equal(g[g.length - 1], '')
  const d = mod.showItemsArgv('dbus-send', 'file:///a/f.txt')
  assert.ok(d.includes('array:string:file:///a/f.txt'))
  assert.ok(d.includes('--type=method_call'))
  assert.equal(mod.showItemsArgv('other', 'x'), null)
}

// ---------------------------------------------------------------------------
// AppleScript quoting
// ---------------------------------------------------------------------------
{
  assert.equal(mod.appleQuote('/home/me/proj'), '/home/me/proj')
  assert.equal(mod.appleQuote('/home/me/my "proj"'), '/home/me/my \\"proj\\"')
  assert.equal(mod.appleQuote('back\\slash'), 'back\\\\slash')
}

// ---------------------------------------------------------------------------
// Platform gating
// ---------------------------------------------------------------------------
{
  mod._setInternals({ platform: 'linux' })
  assert.equal(mod.entryApplies({ id: 'x', bins: ['x'], args: () => [] }), true)
  assert.equal(mod.entryApplies({ id: 'x', linuxOnly: true }), true)
  assert.equal(mod.entryApplies({ id: 'x', darwinOnly: true }), false)
  assert.equal(mod.entryApplies({ id: 'x', winOnly: true }), false)

  mod._setInternals({ platform: 'darwin' })
  assert.equal(mod.entryApplies({ id: 'x', darwinOnly: true }), true)
  assert.equal(mod.entryApplies({ id: 'x', linuxOnly: true }), false)

  mod._setInternals({ platform: 'win32' })
  assert.equal(mod.entryApplies({ id: 'x', winOnly: true }), true)
  assert.equal(mod.entryApplies({ id: 'x' }), true)
}

// ---------------------------------------------------------------------------
// Launcher catalog sanity
// ---------------------------------------------------------------------------
{
  const ids = mod.CATALOG.map((e) => e.id)
  assert.equal(new Set(ids).size, ids.length, 'catalog ids are unique')
  assert.ok(ids.every((id) => typeof id === 'string' && /^[a-z0-9-]+$/.test(id)), 'ids are route-safe')
  for (const wanted of ['vscode', 'cursor', 'antigravity', 'zcode', 'berd', 'orca', 'trae', 'kiro', 'void', 'warp', 'ghostty']) {
    assert.ok(ids.includes(wanted), 'catalog carries ' + wanted)
  }
  // every entry builds args from a path without throwing
  for (const entry of mod.CATALOG) {
    assert.doesNotThrow(() => entry.args('/tmp/proj'), entry.id + ' args builder works')
    assert.ok(Array.isArray(entry.args('/tmp/proj')), entry.id + ' args is an array')
  }
}

// ---------------------------------------------------------------------------
// Detection against a fake PATH
// ---------------------------------------------------------------------------
const fakeBin = join(tmp, 'bin')
mkdirSync(fakeBin)
for (const name of ['code', 'gnome-terminal', 'xdg-open', 'nautilus', 'warp']) {
  const p = join(fakeBin, name)
  writeFileSync(p, '#!/bin/sh\n')
  chmodSync(p, 0o755)
}
mod._setInternals({
  platform: 'linux',
  pathEnv: fakeBin + ':/nowhere',
})
mod.resetDetectCache()
{
  const targets = await mod.detectTargets()
  const byId = Object.fromEntries(targets.map((t) => [t.id, t]))
  assert.equal(byId.vscode.available, true)
  assert.equal(byId.vscode.bin, join(fakeBin, 'code'))
  assert.equal(byId['gnome-terminal'].available, true)
  assert.equal(byId.cursor.available, false)
  assert.equal(byId.cursor.bin, null)
  assert.equal(byId['xdg-open'].available, true)
  // darwin-only entries never surface on linux
  assert.equal(byId.finder, undefined)
  assert.equal(byId['apple-terminal'], undefined)

  // cached until invalidated
  rmSync(join(fakeBin, 'code'))
  const again = await mod.detectTargets()
  assert.equal(again.find((t) => t.id === 'vscode').available, true, 'cached result survives')
  mod.resetDetectCache()
  const fresh = await mod.detectTargets()
  assert.equal(fresh.find((t) => t.id === 'vscode').available, false, 'rescan notices removal')

  // restore so route tests below see vscode again
  writeFileSync(join(fakeBin, 'code'), '#!/bin/sh\n')
  chmodSync(join(fakeBin, 'code'), 0o755)
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------
mod.resetDetectCache()
function mount(ctxGet) {
  const map = {}
  mod.apply({
    effect: (fn) => { fn(); return () => {} },
    get: ctxGet || (() => undefined),
    webServer: { register: (def) => { map[def.path] = def; return () => {} } },
  })
  return map
}
const routes = mount()

function fakeReq(methodOrHeaders, headersOrBody, url, body) {
  if (typeof methodOrHeaders === 'object' && methodOrHeaders !== null) {
    // fakeReq(headers, jsonBody) — a trusted same-origin POST.
    return mkReq('POST', methodOrHeaders, '/', headersOrBody)
  }
  return mkReq(methodOrHeaders, headersOrBody, url || '/', body)
}
function mkReq(method, headers, url, body) {
  return {
    method,
    headers,
    url,
    on(event, cb) {
      if (event === 'data' && body !== undefined) cb(Buffer.from(typeof body === 'string' ? body : JSON.stringify(body)))
      if (event === 'end') cb()
    },
  }
}
function fakeRes() {
  const r = { status: 0, body: '' }
  r.writeHead = (s) => { r.status = s }
  r.end = (b) => { r.body = b }
  return r
}
async function post(path, payload, headers) {
  const res = fakeRes()
  await routes[path].handler(fakeReq(headers ?? { host: '127.0.0.1:3080' }, payload), res)
  return res
}
async function get(path, headers) {
  const res = fakeRes()
  await routes[path.split('?')[0]].handler(mkReq('GET', headers ?? { host: '127.0.0.1:3080' }, path, undefined), res)
  return res
}

const local = { host: '127.0.0.1:3080' }
const evil = { host: 'evil.example', origin: 'https://evil.example' }

const projectDir = join(tmp, 'project')
mkdirSync(projectDir)
// a file buried several levels under the project root
const deepDir = join(projectDir, 'src', 'lib', 'deep')
mkdirSync(deepDir, { recursive: true })
const deepFile = join(deepDir, 'mod.js')
writeFileSync(deepFile, 'export {}\n')

// ---- GET /state -------------------------------------------------------------
{
  const res = await get('/dsh-my-workspace/state')
  assert.equal(res.status, 200)
  const state = JSON.parse(res.body)
  assert.equal(state.platform, 'linux')
  assert.ok(Array.isArray(state.targets) && state.targets.length > 0)
  assert.deepEqual(state.settings, { defaultTarget: null })
  const byId = Object.fromEntries(state.targets.map((t) => [t.id, t]))
  assert.equal(byId.vscode.available, true)

  // untrusted request rejects
  const bad = await get('/dsh-my-workspace/state', evil)
  assert.equal(bad.status, 403)
}

// ---- POST /open -------------------------------------------------------------
let spawned = null
mod._setInternals({
  platform: 'linux',
  pathEnv: fakeBin + ':/nowhere',
  launchSettleMs: 5,
  spawn(bin, args, options) {
    spawned = { bin, args, options }
    return { once() {}, unref() {} }
  },
})
mod.resetDetectCache()

{
  // happy path: VS Code receives the directory as its sole argument
  spawned = null
  const res = await post('/dsh-my-workspace/open', { target: 'vscode', path: projectDir })
  assert.equal(res.status, 200)
  assert.equal(spawned.bin, join(fakeBin, 'code'))
  assert.deepEqual(spawned.args, [projectDir])
  assert.equal(spawned.options.detached, true)
  assert.equal(spawned.options.stdio, 'ignore')
  assert.equal(JSON.parse(res.body).ok, true)

  // a FILE many levels under the project opens exactly in the IDE
  spawned = null
  const fileRes = await post('/dsh-my-workspace/open', { target: 'vscode', path: deepFile })
  assert.equal(fileRes.status, 200)
  assert.deepEqual(spawned.args, [deepFile])
  const fileBody = JSON.parse(fileRes.body)
  assert.equal(fileBody.kind, 'file')

  // terminal + file: sits in the file's directory (multi levels down)
  spawned = null
  await post('/dsh-my-workspace/open', { target: 'gnome-terminal', path: deepFile })
  assert.deepEqual(spawned.args, ['--working-directory=' + deepDir])

  // file manager + file without any DBus tool on PATH: opens the parent dir
  spawned = null
  await post('/dsh-my-workspace/open', { target: 'nautilus', path: deepFile })
  assert.equal(spawned.bin, join(fakeBin, 'nautilus'))
  assert.deepEqual(spawned.args, [deepDir])

  // with gdbus present the freedesktop reveal verb selects the file instead
  writeFileSync(join(fakeBin, 'gdbus'), '#!/bin/sh\n')
  chmodSync(join(fakeBin, 'gdbus'), 0o755)
  spawned = null
  const revealRes = await post('/dsh-my-workspace/open', { target: 'nautilus', path: deepFile })
  assert.equal(revealRes.status, 200)
  assert.equal(spawned.bin, join(fakeBin, 'gdbus'))
  assert.ok(JSON.stringify(spawned.args).includes('org.freedesktop.FileManager1.ShowItems'), 'reveal method called')
  assert.ok(JSON.stringify(spawned.args).includes('file://'), 'file URI passed')
  assert.equal(JSON.parse(revealRes.body).revealed, true)

  // terminal target carries its working-directory flag
  spawned = null
  await post('/dsh-my-workspace/open', { target: 'gnome-terminal', path: projectDir })
  assert.deepEqual(spawned.args, ['--working-directory=' + projectDir])

  // file manager + directory target
  spawned = null
  await post('/dsh-my-workspace/open', { target: 'nautilus', path: projectDir })
  assert.equal(spawned.bin, join(fakeBin, 'nautilus'))
  assert.deepEqual(spawned.args, [projectDir])

  // cwd-based targets (Warp) launch plain and inherit the directory
  spawned = null
  await post('/dsh-my-workspace/open', { target: 'warp', path: projectDir })
  assert.deepEqual(spawned.args, [])
  assert.equal(spawned.options.cwd, projectDir)
}

// rejections: relative path, unknown target, missing path, absent launcher, untrusted
for (const [name, body, code] of [
  ['relative path', { target: 'vscode', path: 'relative/dir' }, 400],
  ['unknown target', { target: 'nope', path: projectDir }, 400],
  ['missing path', { target: 'vscode', path: join(tmp, 'no-such-thing') }, 400],
]) {
  const res = await post('/dsh-my-workspace/open', body)
  assert.equal(res.status, code, name + ' rejected with ' + code)
}
{
  const res = await post('/dsh-my-workspace/open', { target: 'cursor', path: projectDir })
  assert.equal(res.status, 400)
  assert.match(JSON.parse(res.body).error, /not available/)
}
{
  const res = await post('/dsh-my-workspace/open', { target: 'vscode', path: projectDir }, evil)
  assert.equal(res.status, 403)
}

// ---- POST /settings ----------------------------------------------------------
{
  let res = await post('/dsh-my-workspace/settings', { defaultTarget: 'vscode' })
  assert.equal(res.status, 200)
  res = await get('/dsh-my-workspace/state')
  assert.deepEqual(JSON.parse(res.body).settings, { defaultTarget: 'vscode' })

  // persisted under $DSH_HOME/dsh-my-workspace/settings.json
  const raw = JSON.parse(readFileSync(join(tmp, 'dsh-my-workspace', 'settings.json'), 'utf8'))
  assert.equal(raw.defaultTarget, 'vscode')

  // clearing back to none
  res = await post('/dsh-my-workspace/settings', { defaultTarget: null })
  res = await get('/dsh-my-workspace/state')
  assert.deepEqual(JSON.parse(res.body).settings, { defaultTarget: null })

  // unknown ids reject
  res = await post('/dsh-my-workspace/settings', { defaultTarget: 'bogus' })
  assert.equal(res.status, 400)
}

// ---- GET /workspaces ---------------------------------------------------------
{
  // Without a workspaceRegistry the route degrades to an empty list.
  const res = await get('/dsh-my-workspace/workspaces')
  assert.equal(res.status, 200)
  assert.deepEqual(JSON.parse(res.body), { workspaces: [] })

  const bad = await get('/dsh-my-workspace/workspaces', evil)
  assert.equal(bad.status, 403)

  // With one, only the id/title/path leaves are exposed, entries without a
  // path are skipped, ids are coerced to strings, and output sorts by title.
  // The registry resolves lazily per request: the real service finishes its
  // bootstrap only after apply() (it waits on storageDomain +
  // sessionPersistence), so a registry that appears later must be listed —
  // capturing it at apply time froze `undefined` and every click on a
  // sidebar row degraded to "Workspace path not found."
  let registry = undefined
  const wsRoutes = mount(() => registry)
  const early = fakeRes()
  await wsRoutes['/dsh-my-workspace/workspaces'].handler(mkReq('GET', local, '/dsh-my-workspace/workspaces'), early)
  assert.equal(early.status, 200)
  assert.deepEqual(JSON.parse(early.body), { workspaces: [] }, 'registry not yet started reads as empty')

  registry = {
    list: () => [
      { id: 7, title: 'zebra', path: '/work/zebra' },
      { id: 'abc', title: 'alpha', path: '/work/alpha', createdAt: 1, updatedAt: 2, sessionIds: ['s1'], record: { secret: true } },
      { id: 'x', title: 'no-path' },
    ],
  }
  const res2 = fakeRes()
  await wsRoutes['/dsh-my-workspace/workspaces'].handler(mkReq('GET', local, '/dsh-my-workspace/workspaces'), res2)
  assert.equal(res2.status, 200)
  const body = JSON.parse(res2.body)
  assert.deepEqual(body.workspaces, [
    { id: 'abc', title: 'alpha', path: '/work/alpha' },
    { id: '7', title: 'zebra', path: '/work/zebra' },
  ])
}

// ---- workspace_open model tool -------------------------------------------------
{
  const toolDefs = []
  mount((key) => key === 'tools'
    ? { register: (def) => { toolDefs.push(def); return () => {} } }
    : undefined)
  assert.equal(toolDefs.length, 1, 'one tool registered when a tools service exists')
  const wsOpen = toolDefs[0]
  assert.equal(wsOpen.name, 'workspace_open')
  assert.deepEqual(wsOpen.parameters.required, ['path'])
  assert.equal(typeof wsOpen.execute, 'function')

  // default opener resolves to the first available IDE (vscode on fake PATH)
  spawned = null
  const r1 = await wsOpen.execute({ path: deepFile })
  assert.equal(r1.ok, true)
  assert.equal(spawned.bin, join(fakeBin, 'code'))
  assert.deepEqual(spawned.args, [deepFile])
  assert.match(r1.text, /Opened/)
  assert.match(r1.text, /vscode/)

  // explicit terminal target on a file sits in its directory
  spawned = null
  const r2 = await wsOpen.execute({ path: deepFile, target: 'gnome-terminal' })
  assert.equal(r2.ok, true)
  assert.deepEqual(spawned.args, ['--working-directory=' + deepDir])
  assert.match(r2.text, /kind=file/)

  // failures come back as structured text, never throw
  const r3 = await wsOpen.execute({ path: deepFile, target: 'nope' })
  assert.equal(r3.ok, false)
  assert.match(r3.text, /unknown target/)
  const r4 = await wsOpen.execute({ path: join(tmp, 'gone.txt') })
  assert.equal(r4.ok, false)
  assert.match(r4.text, /Failed to open/)

  // with no launcher on PATH and no stored default it says so plainly
  mod._setInternals({
    platform: 'linux',
    pathEnv: '/nowhere',
    launchSettleMs: 5,
    spawn(bin, args, options) {
      spawned = { bin, args, options }
      return { once() {}, unref() {} }
    },
  })
  mod.resetDetectCache()
  const r5 = await wsOpen.execute({ path: projectDir })
  assert.equal(r5.ok, false)
  assert.match(r5.text, /No supported launcher/)

  // restore for any later assertions
  mod._setInternals({
    platform: 'linux',
    pathEnv: fakeBin + ':/nowhere',
    launchSettleMs: 5,
    spawn(bin, args, options) {
      spawned = { bin, args, options }
      return { once() {}, unref() {} }
    },
  })
  mod.resetDetectCache()
}

// ---------------------------------------------------------------------------
// Quick terminal: pure helpers
// ---------------------------------------------------------------------------
{
  // command validation + trailing-& backgrounding
  assert.deepEqual(mod.normalizeTerminalCmd('ls -la'), { cmd: 'ls -la', background: false })
  assert.deepEqual(mod.normalizeTerminalCmd('sleep 5 &'), { cmd: 'sleep 5', background: true })
  assert.deepEqual(mod.normalizeTerminalCmd('  make test  &  '), { cmd: '  make test', background: true }, 'only the tail is stripped')
  assert.deepEqual(mod.normalizeTerminalCmd('echo a && echo b'), { cmd: 'echo a && echo b', background: false }, 'interior && untouched')
  assert.equal(mod.normalizeTerminalCmd('&'), null, 'ampersand alone is not a command')
  assert.equal(mod.normalizeTerminalCmd(''), null)
  assert.equal(mod.normalizeTerminalCmd('   '), null)
  assert.equal(mod.normalizeTerminalCmd(null), null)
  assert.equal(mod.normalizeTerminalCmd(42), null)
  assert.equal(mod.normalizeTerminalCmd('x\0y'), null)
  assert.equal(mod.normalizeTerminalCmd('x'.repeat(mod.TERMINAL_MAX_CMD + 1)), null)

  // UTF-8-safe slicing of streamed output
  const enc = (s) => Buffer.from(s, 'utf8')
  assert.equal(mod.utf8SafeLength(Buffer.alloc(0)), 0)
  assert.equal(mod.utf8SafeLength(enc('abc')), 3)
  assert.equal(mod.utf8SafeLength(enc('a\u00e9')), enc('a\u00e9').length, 'complete sequence stays whole')
  assert.equal(mod.utf8SafeLength(enc('a\u00e9').subarray(0, 2)), 1, 'split 2-byte tail is cut')
  assert.equal(mod.utf8SafeLength(enc('\u00e9').subarray(0, 1)), 0, 'lone lead byte yields nothing yet')
  const emoji = enc('a\ud83d\ude00')
  assert.equal(mod.utf8SafeLength(emoji), emoji.length)
  assert.equal(mod.utf8SafeLength(emoji.subarray(0, 3)), 1, 'split 4-byte tail is cut')

  // shell selection
  mod._setInternals({ platform: 'linux', shellBin: '/bin/fakesh' })
  assert.deepEqual(mod.terminalShellArgv('x'), { bin: '/bin/fakesh', args: ['-c', 'x'] })
  mod._setInternals({ platform: 'linux' })
  const expectedShell =
    process.env.SHELL && process.env.SHELL.trim() !== '' ? process.env.SHELL : '/bin/sh'
  assert.deepEqual(mod.terminalShellArgv('x'), { bin: expectedShell, args: ['-c', 'x'] })
}

// ---------------------------------------------------------------------------
// Quick terminal: routes against a fake child process
// ---------------------------------------------------------------------------
{
  let fakeSeq = 0
  let lastArgv = null
  let lastChild = null
  const liveChildren = []
  function fakeChild() {
    fakeSeq += 1
    const child = {
      pid: 4100000 + fakeSeq,
      signals: [],
      stdoutCbs: [],
      stderrCbs: [],
      exitCbs: [],
      errorCbs: [],
      stdout: { on(ev, cb) { if (ev === 'data') child.stdoutCbs.push(cb) } },
      stderr: { on(ev, cb) { if (ev === 'data') child.stderrCbs.push(cb) } },
      once(ev, cb) {
        if (ev === 'exit') child.exitCbs.push(cb)
        if (ev === 'error') child.errorCbs.push(cb)
      },
      on(ev, cb) { child.once(ev, cb) },
      kill(sig) { child.signals.push(sig); return true },
      emitOut(buf) { [...child.stdoutCbs].forEach((cb) => cb(buf)) },
      emitErr(buf) { [...child.stderrCbs].forEach((cb) => cb(buf)) },
      emitExit(code, sig) { [...child.exitCbs].forEach((cb) => cb(code, sig)) },
    }
    return child
  }
  function setStub(extra) {
    mod._setInternals({
      platform: 'linux',
      pathEnv: fakeBin + ':/nowhere',
      launchSettleMs: 5,
      shellBin: '/bin/fakesh',
      killGraceMs: 20,
      spawn(bin, args, options) {
        lastArgv = { bin, args, options }
        lastChild = fakeChild()
        liveChildren.push(lastChild)
        return lastChild
      },
      ...extra,
    })
    mod.resetDetectCache()
  }
  setStub()

  const RUN = '/dsh-my-workspace/terminal/run'
  const OUT = '/dsh-my-workspace/terminal/output'
  const KILL = '/dsh-my-workspace/terminal/kill'
  const JOBS = '/dsh-my-workspace/terminal/jobs'

  // happy path: the command reaches the configured shell, cwd validated
  let res = await post(RUN, { cwd: projectDir, cmd: 'echo hello' })
  assert.equal(res.status, 200)
  const job1 = JSON.parse(res.body).job
  assert.ok(job1.id.length > 2 && /^t[0-9a-z]+$/.test(job1.id), 'route-safe job id')
  assert.equal(job1.running, true)
  assert.equal(job1.background, false)
  assert.equal(lastArgv.bin, '/bin/fakesh')
  assert.deepEqual(lastArgv.args, ['-c', 'echo hello'], 'trailing & would be stripped before spawn')
  assert.equal(lastArgv.options.cwd, projectDir)
  assert.deepEqual(lastArgv.options.stdio, ['ignore', 'pipe', 'pipe'])
  assert.equal(lastArgv.options.detached, true, 'POSIX children lead their own process group')

  // output streams incrementally through the since cursor
  let out = await get(`${OUT}?id=${job1.id}&since=0`)
  assert.equal(JSON.parse(out.body).running, true)
  assert.equal(JSON.parse(out.body).data, '')
  lastChild.emitOut(Buffer.from('hello '))
  out = await get(`${OUT}?id=${job1.id}&since=0`)
  let body = JSON.parse(out.body)
  assert.equal(body.data, 'hello ')
  assert.equal(body.totalBytes, 6)
  assert.equal(body.nextCursor, 6)
  out = await get(`${OUT}?id=${job1.id}&since=${body.nextCursor}`)
  assert.equal(JSON.parse(out.body).data, '', 'incremental poll returns only new bytes')

  // a multi-byte character split across pipe writes never yields U+FFFD
  lastChild.emitOut(Buffer.from('w\u00f6rld'))
  lastChild.emitErr(Buffer.from('\u00e9', 'utf8').subarray(0, 1))
  out = await get(`${OUT}?id=${job1.id}&since=6`)
  body = JSON.parse(out.body)
  assert.equal(body.data.includes('w\u00f6rld'), true)
  assert.ok(!body.data.includes('\uFFFD'), 'partial character withheld')
  assert.equal(body.nextCursor, 12, 'cursor parks before the withheld lead byte')
  lastChild.emitErr(Buffer.from('\u00e9', 'utf8').subarray(1, 2))
  out = await get(`${OUT}?id=${job1.id}&since=12`)
  body = JSON.parse(out.body)
  assert.ok(body.data.endsWith('\u00e9'), 'withheld bytes arrive on the next poll')
  assert.equal(body.nextCursor, 14)

  lastChild.emitExit(0, null)
  out = await get(`${OUT}?id=${job1.id}&since=15`)
  body = JSON.parse(out.body)
  assert.equal(body.running, false)
  assert.equal(body.exitCode, 0)
  assert.ok(typeof body.finishedAt === 'number')

  // trailing & requests backgrounding and is stripped from the exec'd command
  res = await post(RUN, { cwd: projectDir, cmd: 'sleep 30 &' })
  assert.equal(res.status, 200)
  const bgJob = JSON.parse(res.body).job
  assert.equal(bgJob.background, true)
  assert.deepEqual(lastArgv.args, ['-c', 'sleep 30'])
  const stubborn = lastChild

  // kill escalates TERM -> KILL when the child ignores TERM
  const kRes = await post(KILL, { id: bgJob.id })
  assert.equal(kRes.status, 200)
  assert.deepEqual(stubborn.signals, ['SIGTERM', 'SIGKILL'], 'TERM first, KILL after the grace')
  out = await get(`${OUT}?id=${bgJob.id}&since=0`)
  body = JSON.parse(out.body)
  assert.equal(body.running, true, 'exit is only observed through the child event')
  stubborn.emitExit(null, 'SIGTERM')
  out = await get(`${OUT}?id=${bgJob.id}&since=0`)
  body = JSON.parse(out.body)
  assert.equal(body.running, false)
  assert.equal(body.signal, 'SIGTERM')

  // the jobs listing resolves cmd -> id for a second kill round
  await post(RUN, { cwd: projectDir, cmd: 'sleep 60' })
  const stubborn2 = lastChild
  const listing = await get(JOBS)
  assert.equal(listing.status, 200)
  const listed = JSON.parse(listing.body).jobs
  assert.ok(Array.isArray(listed) && listed.length >= 1)
  const target = listed.find((j) => j.cmd === 'sleep 60')
  assert.ok(target, 'running job retained and listed')
  assert.equal((await post(KILL, { id: target.id })).status, 200)
  assert.deepEqual(stubborn2.signals, ['SIGTERM', 'SIGKILL'], 'second kill repeats the ladder')
  stubborn2.emitExit(null, 'SIGTERM')

  // rejections and trust guard
  assert.equal((await post(KILL, { id: 'tmissing' })).status, 404, 'unknown kill id')
  const missOut = await get(`${OUT}?id=tmissing&since=0`)
  assert.equal(missOut.status, 404)
  assert.equal((await post(RUN, { cwd: projectDir })).status, 400, 'missing cmd')
  assert.equal((await post(RUN, { cwd: 'relative/dir', cmd: 'x' })).status, 400, 'relative cwd')
  assert.equal((await post(RUN, { cwd: join(tmp, 'no-such-dir'), cmd: 'x' })).status, 400, 'absent cwd')
  assert.equal((await post(RUN, { cwd: deepFile, cmd: 'x' })).status, 400, 'file cwd is not a directory')
  assert.equal((await post(RUN, { cwd: projectDir, cmd: 'x'.repeat(mod.TERMINAL_MAX_CMD + 1) })).status, 400, 'oversized cmd')
  assert.equal((await post(RUN, { cwd: projectDir, cmd: 'x' }, evil)).status, 403, 'untrusted run')
  assert.equal((await get(JOBS, evil)).status, 403, 'untrusted jobs')

  // concurrent-running cap
  mod._resetTerminalJobs()
  let accepted = 0
  for (let i = 0; i < mod.TERMINAL_MAX_RUNNING + 1; i++) {
    const capRes = await post(RUN, { cwd: projectDir, cmd: 'job' + i })
    if (capRes.status === 200) accepted += 1
    else {
      assert.equal(accepted, mod.TERMINAL_MAX_RUNNING, 'the first N runs pass')
      assert.match(JSON.parse(capRes.body).error, /too many running/)
    }
  }
  assert.equal(accepted, mod.TERMINAL_MAX_RUNNING)

  // jobs listing: leaf views, newest first
  const listRes = await get(JOBS)
  const list = JSON.parse(listRes.body).jobs
  assert.equal(list.length, mod.TERMINAL_MAX_RUNNING)
  for (const view of list) {
    assert.ok(typeof view.id === 'string' && typeof view.cmd === 'string' && typeof view.cwd === 'string')
    assert.equal(view.running, true)
    assert.ok(!('child' in view) && !('chunks' in view), 'live handles never leak into the payload')
  }
  assert.ok(list.every((v, i) => i === 0 || list[i - 1].startedAt >= v.startedAt), 'newest first')

  // plugin teardown takes the running tree down
  mod.stopAllTerminalJobs()
  assert.ok(liveChildren.some((c) => c.signals.includes('SIGTERM')), 'dispose kills running jobs')
  mod._resetTerminalJobs()
}

console.log('host.test.mjs: all assertions passed')
