// Client-half smoke test: the bundle registers with the ModuleLoader, the
// factory exposes the expected contract, the dictionaries stay zh/en
// balanced (the host rejects unbalanced registrations), and both slots —
// the session-header quick actions and the settings section — register.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

let captured = null
globalThis.window = {
  __ModuleLoader__: {
    load: (definition) => { captured = definition },
  },
}

const clientPath = fileURLToPath(new URL('../lib/client.js', import.meta.url))

await import(clientPath + '?smoke=' + Date.now())

assert.ok(captured, 'client registered a bundle')
assert.equal(captured.id, 'dsh-my-workspace')

const fakeElement = () => ({})
const fakeReact = {
  createElement: fakeElement,
  Fragment: 'Fragment',
  useState: (init) => [init, () => {}],
  useRef: (init) => ({ current: init }),
  useEffect: () => {},
  useLayoutEffect: () => {},
  useCallback: (fn) => fn,
}
const fakeReactDOM = { createPortal: () => null }

const mod = captured.factory((moduleName) => {
  if (moduleName === 'react') return fakeReact
  if (moduleName === 'react-dom') return fakeReactDOM
  throw new Error('unexpected require: ' + moduleName)
})

assert.equal(mod.name, 'dsh-my-workspace')
assert.deepEqual(mod.inject, ['slots', 'locale'])
assert.equal(typeof mod.apply, 'function')
assert.equal(typeof mod.WorkspaceMenuButton, 'function')
assert.equal(typeof mod.WorkspaceSettingsSection, 'function')
assert.equal(typeof mod.WorkspaceRowOverlay, 'function')
assert.equal(typeof mod.resolveWorkspacePath, 'function')
assert.equal(typeof mod.TerminalButton, 'function')
assert.equal(typeof mod.TermPanel, 'function')
assert.ok(mod.termStore && typeof mod.termStore === 'object', 'terminal store exported')

// Trailing-& parsing mirrors the host's normalization: the UI annotates a
// background run instantly, without waiting for the response.
assert.deepEqual(mod.splitTrailingAmp('ls -la'), { cmd: 'ls -la', background: false })
assert.deepEqual(mod.splitTrailingAmp('sleep 5 &'), { cmd: 'sleep 5', background: true })
assert.deepEqual(mod.splitTrailingAmp('  make  & '), { cmd: '  make', background: true })
assert.equal(mod.splitTrailingAmp('echo &&').cmd, 'echo')
assert.equal(mod.splitTrailingAmp('echo &&').background, true)
assert.equal(mod.splitTrailingAmp('   '), null)
assert.equal(mod.splitTrailingAmp(null), null)

// Sidebar label → workspace path resolution: exact title first, then unique
// basename fallback, else null.
const wsList = [
  { id: 'a', title: 'hermes', path: '/work/hermes' },
  { id: 'b', title: 'My Project', path: '/deep/My Project' },
]
assert.equal(mod.resolveWorkspacePath('hermes', wsList), '/work/hermes')
assert.equal(mod.resolveWorkspacePath('My Project', wsList), '/deep/My Project')
assert.equal(mod.resolveWorkspacePath('project', wsList), null, 'basename cannot override a title miss')
assert.equal(
  mod.resolveWorkspacePath('other', [{ id: 'c', title: '', path: '/work/other' }]),
  '/work/other',
  'basename fallback hits untitled workspaces',
)
assert.equal(mod.resolveWorkspacePath('', wsList), null)
assert.equal(mod.resolveWorkspacePath('x', undefined), null)

// Settings-nav glyph patch wiring: exported matcher + mount lifecycle.
assert.equal(typeof mod.mountSettingsNavGlyph, 'function')
assert.equal(typeof mod.isWorkspaceNavLabel, 'function')
assert.equal(mod.isWorkspaceNavLabel('Workspace'), true)
assert.equal(mod.isWorkspaceNavLabel('\u5de5\u4f5c\u533a'), true)
assert.equal(mod.isWorkspaceNavLabel('Workspace \u00b7 extras'), true)
assert.equal(mod.isWorkspaceNavLabel('Restart \u91cd\u542f'), false)
assert.equal(mod.isWorkspaceNavLabel(''), false)
assert.equal(mod.isWorkspaceNavLabel(null), false)

// Styles are exported for theming checks and must be theme-token driven.
assert.ok(Array.isArray(mod.styles), 'styles are exported for theming checks')
assert.ok(mod.styles.some((s) => s.startsWith('.dshmws-menu{')), 'menu style present')
assert.ok(mod.styles.some((s) => s.includes('--dsw-alias-bg-layer-1')), 'menu background follows the theme token')
assert.ok(mod.styles.some((s) => s.startsWith('.dshmws-trigger')), 'trigger style present')
assert.ok(mod.styles.some((s) => s.startsWith('.dshmws-rowbtn{')), 'sidebar row trigger style present')
assert.ok(mod.styles.some((s) => s.startsWith('.dshmws-term{')), 'terminal panel style present')
assert.ok(
  mod.styles.some((s) => s.includes('--dsw-alias-bg-layer-1') && s.includes('.dshmws-term')),
  'terminal panel follows the theme tokens too',
)
assert.ok(
  mod.styles.some((s) => s.includes('prefers-reduced-motion') && s.includes('.dshmws-term')),
  'the unfold animation respects reduced motion',
)

// i18n parity: the host locale service rejects unbalanced dictionaries.
const en = Object.keys(mod.strings.en).sort()
const zh = Object.keys(mod.strings.zh).sort()
assert.deepEqual(en, zh, 'en/zh dictionaries have identical key sets')
for (const key of ['termTitle', 'termRunLabel', 'termStop', 'termBgToggle', 'termEmptyHint']) {
  assert.ok(en.includes(key), 'dictionary carries ' + key)
}

// apply() registers both seats through the slots service, inside ctx.effect.
const registered = []
const injected = []
let effects = 0
const slots = {
  inject(name, fn) {
    injected.push(name)
    this._pending = fn
    const disposer = fn()
    if (typeof disposer === 'function') registered.push(disposer)
  },
  register(options, component) {
    registered.push({ name: options.name, id: options.id })
    assert.equal(typeof component, 'function', options.name + ' renders a component')
    return () => {}
  },
}
mod.apply({
  effect(fn) { effects += 1; return fn() },
  get(key) {
    if (key === 'slots') return slots
    if (key === 'locale') {
      return {
        register(ns, dict) {
          assert.equal(ns, 'myWorkspace')
          assert.equal(dict, mod.strings)
          return () => {}
        },
        bind() { return (key2) => key2 },
      }
    }
    return undefined
  },
})

assert.ok(injected.includes('conversation.session.header.actions'), 'header quick actions seat used')
assert.ok(injected.includes('settings.section'), 'settings section seat used')
assert.ok(injected.includes('shell.overlay'), 'frame overlay seat used for the row menu')
const headerReg = registered.find((r) => r.name === 'conversation.session.header.actions' && r.id)
assert.equal(headerReg && headerReg.id, 'workspace-actions')
const terminalReg = registered.find((r) => r.name === 'conversation.session.header.actions' && r.id === 'workspace-terminal')
assert.ok(terminalReg, 'the quick terminal registers beside the launcher menu')
const sectionReg = registered.find((r) => r.name === 'settings.section' && r.id)
assert.equal(sectionReg && sectionReg.id, 'my-workspace')
const overlayReg = registered.find((r) => r.name === 'shell.overlay' && r.id)
assert.equal(overlayReg && overlayReg.id, 'workspace-row-menu')
assert.ok(effects >= 2, 'dictionaries and sidebar row-button mount run inside ctx.effect')

// The bundle must never reference Node-only globals or JSX.
const code = readFileSync(clientPath, 'utf8')
for (const banned of ['require(\'fs\')', 'require("fs")', '<div', '<span']) {
  assert.ok(!code.includes(banned), 'bundle avoids ' + banned)
}

console.log('client.test.mjs: all assertions passed')
