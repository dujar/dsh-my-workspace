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

// Styles are exported for theming checks and must be theme-token driven.
assert.ok(Array.isArray(mod.styles), 'styles are exported for theming checks')
assert.ok(mod.styles.some((s) => s.startsWith('.dshmws-menu{')), 'menu style present')
assert.ok(mod.styles.some((s) => s.includes('--dsw-alias-bg-layer-1')), 'menu background follows the theme token')
assert.ok(mod.styles.some((s) => s.startsWith('.dshmws-trigger')), 'trigger style present')

// i18n parity: the host locale service rejects unbalanced dictionaries.
const en = Object.keys(mod.strings.en).sort()
const zh = Object.keys(mod.strings.zh).sort()
assert.deepEqual(en, zh, 'en/zh dictionaries have identical key sets')

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
const headerReg = registered.find((r) => r.name === 'conversation.session.header.actions' && r.id)
assert.equal(headerReg && headerReg.id, 'workspace-actions')
const sectionReg = registered.find((r) => r.name === 'settings.section' && r.id)
assert.equal(sectionReg && sectionReg.id, 'my-workspace')
assert.ok(effects >= 1, 'dictionaries registered inside ctx.effect')

// The bundle must never reference Node-only globals or JSX.
const code = readFileSync(clientPath, 'utf8')
for (const banned of ['require(\'fs\')', 'require("fs")', '<div', '<span']) {
  assert.ok(!code.includes(banned), 'bundle avoids ' + banned)
}

console.log('client.test.mjs: all assertions passed')
