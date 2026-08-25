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
// Detection against a fake PATH
// ---------------------------------------------------------------------------
const fakeBin = join(tmp, 'bin')
mkdirSync(fakeBin)
for (const name of ['code', 'gnome-terminal', 'xdg-open', 'nautilus']) {
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
const routes = {}
mod.apply({ effect: (fn) => { fn(); return () => {} }, webServer: { register: (def) => { routes[def.path] = def; return () => {} } } })

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

  // terminal target carries its working-directory flag
  spawned = null
  await post('/dsh-my-workspace/open', { target: 'gnome-terminal', path: projectDir })
  assert.deepEqual(spawned.args, ['--working-directory=' + projectDir])

  // file manager target
  spawned = null
  await post('/dsh-my-workspace/open', { target: 'nautilus', path: projectDir })
  assert.equal(spawned.bin, join(fakeBin, 'nautilus'))
  assert.deepEqual(spawned.args, [projectDir])
}

// rejections: relative path, unknown target, missing directory, absent launcher, untrusted
for (const [name, body, code] of [
  ['relative path', { target: 'vscode', path: 'relative/dir' }, 400],
  ['unknown target', { target: 'nope', path: projectDir }, 400],
  ['missing dir', { target: 'vscode', path: join(tmp, 'no-such-dir') }, 400],
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

console.log('host.test.mjs: all assertions passed')
