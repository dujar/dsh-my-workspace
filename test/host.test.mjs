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
  await routes[path].handler(mkReq('GET', headers ?? { host: '127.0.0.1:3080' }, path, undefined), res)
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
  const wsRoutes = mount(() => ({
    list: () => [
      { id: 7, title: 'zebra', path: '/work/zebra' },
      { id: 'abc', title: 'alpha', path: '/work/alpha', createdAt: 1, updatedAt: 2, sessionIds: ['s1'], record: { secret: true } },
      { id: 'x', title: 'no-path' },
    ],
  }))
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

console.log('host.test.mjs: all assertions passed')
