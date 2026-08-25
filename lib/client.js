// dsh-my-workspace browser half.
//
// Zero-build hand-written client bundle (same pattern as dsh-restart,
// dsh-community-plugins, and dsh-better-archive): a CJS factory wrapped in
// the ModuleLoader call. React and ReactDOM come from the shell's static
// module table (require("react") / require("react-dom")); slot components
// receive the framework standard kit (sessionId, useSession, useSessions, t)
// through props.
//
// Feature 1 — workspace quick actions:
//
//   * A compact "open workspace" control registered into
//     conversation.session.header.actions (id: workspace-actions). It reads
//     the current session's project root via useSessions(s => s.byId[id].cwd),
//     and opens a portaled popover listing every launcher detected on this
//     machine: editors/IDEs, terminal emulators, file managers — plus
//     "Copy path", which writes the directory to the browser clipboard.
//   * A "Workspace" section registered into settings.section (order 90):
//     pick the default launcher among detected ones, re-scan, and see every
//     known launcher with its availability.
//   * The left panel's workspace rows gain an "open" button beside their
//     hover-revealed kebab + new-session buttons (DOM patch, house pattern):
//     clicking it resolves that workspace's path through
//     GET /dsh-my-workspace/workspaces (backed by the host's durable
//     workspaceRegistry) and opens the same launcher menu anchored at the
//     row, rendered by a shell.overlay occupant.
//
// All reads go through GET /dsh-my-workspace/state and /workspaces; opens
// through POST /dsh-my-workspace/open; the default-launcher preference
// persists host-side through POST /dsh-my-workspace/settings. Path copying
// never round-trips the host: navigator.clipboard runs right in the page.
window.__ModuleLoader__.load({
  id: 'dsh-my-workspace',
  factory: (require) => {
    'use strict'
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    var React = require('react')
    var ReactDOM = require('react-dom')
    var createElement = React.createElement
    var useState = React.useState
    var useRef = React.useRef
    var useEffect = React.useEffect
    var useLayoutEffect = React.useLayoutEffect
    var useCallback = React.useCallback

    // -----------------------------------------------------------------------
    // Styles (injected once, guarded for HMR). Theme-aware: every color is a
    // --dsw-alias-* variable so light/dark themes are followed automatically.
    // Exported as STYLES so tests can assert theming rules.
    // -----------------------------------------------------------------------
    var STYLES = [
        '.dshmws-root{position:relative;display:inline-flex}',
        '.dshmws-trigger{display:inline-flex;align-items:center;gap:4px;border:none;background:transparent;color:var(--dsw-alias-label-secondary);border-radius:8px;padding:4px 7px;font-size:12.5px;font-weight:500;font-family:inherit;cursor:pointer;transition:background .15s ease,color .15s ease}',
        '.dshmws-trigger:hover,.dshmws-trigger[aria-expanded=true]{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}',
        '.dshmws-trigger:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:2px}',
        '.dshmws-trigger svg{width:15px;height:15px;display:block}',
        '.dshmws-chevron{width:10px!important;height:10px!important;transition:transform .15s ease}',
        '.dshmws-trigger[aria-expanded=true] .dshmws-chevron{transform:rotate(180deg)}',
        '.dshmws-menu{position:fixed;z-index:1150;min-width:224px;max-width:300px;max-height:min(420px,70vh);overflow:auto;background:var(--dsw-alias-bg-layer-1,#ffffff);color:var(--dsw-alias-label-primary);border:1px solid var(--dsw-alias-border-l2);border-radius:10px;box-shadow:0 10px 32px color-mix(in srgb,var(--dsw-alias-label-primary) 16%,transparent);padding:5px}',
        '.dshmws-group{font-size:10.5px;font-weight:650;letter-spacing:.04em;text-transform:uppercase;color:var(--dsw-alias-label-tertiary);padding:7px 9px 3px}',
        '.dshmws-item{display:flex;align-items:center;gap:8px;width:100%;border:none;background:transparent;color:var(--dsw-alias-label-primary);border-radius:7px;padding:6px 9px;font-size:12.5px;font-weight:500;font-family:inherit;text-align:left;cursor:pointer;transition:background .12s ease}',
        '.dshmws-item:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}',
        '.dshmws-item:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:-2px}',
        '.dshmws-item:disabled{opacity:.55;cursor:default}',
        '.dshmws-item svg{flex:none;width:14px;height:14px;color:var(--dsw-alias-label-secondary)}',
        '.dshmws-item-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
        '.dshmws-default-dot{flex:none;width:5px;height:5px;border-radius:50%;background:var(--dsw-alias-state-business-primary)}',
        '.dshmws-ok-mark{flex:none;color:var(--dsw-alias-state-success-primary)!important}',
        '.dshmws-divider{height:1px;margin:5px 4px;background:var(--dsw-alias-border-l1)}',
        '.dshmws-menu-empty{padding:10px 9px;font-size:12px;color:var(--dsw-alias-label-tertiary)}',
        '.dshmws-path-line{display:block;padding:7px 9px 4px;font-size:11px;line-height:1.45;color:var(--dsw-alias-label-tertiary);font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;word-break:break-all;-webkit-user-select:text;user-select:text}',
        '.dshmws-error-line{margin:4px;padding:6px 8px;border-radius:6px;font-size:11.5px;background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 12%,transparent);color:var(--dsw-alias-state-error-primary);word-break:break-all}',
        '.dshmws-spin{display:inline-block;flex:none;width:11px;height:11px;border-radius:50%;border:1.5px solid color-mix(in srgb,currentColor 30%,transparent);border-top-color:currentColor;animation:dshmwsSpin .7s linear infinite}',
        '@keyframes dshmwsSpin{to{transform:rotate(360deg)}}',
        // Sidebar workspace-row trigger: mimics the shell's hover-revealed 16px
        // ghost icon buttons so it sits invisibly beside the kebab and +.
        '.dshmws-rowbtn{cursor:pointer;width:16px;height:16px;color:var(--dsw-alias-label-tertiary);background:none;border:none;border-radius:4px;flex:none;justify-content:center;align-items:center;padding:0;display:inline-flex}',
        '.dshmws-rowbtn:hover{color:var(--dsw-alias-label-primary)}',
        '.dshmws-rowbtn:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:1px}',
        '.dshmws-rowbtn svg{width:14px;height:14px;display:block}',
        // ---- settings section -------------------------------------------------
        '.dshmws-section{max-width:560px;display:flex;flex-direction:column;gap:14px;font-family:inherit}',
        '.dshmws-title{margin:0;font-size:17px;font-weight:650;color:var(--dsw-alias-label-primary)}',
        '.dshmws-subtitle{margin:2px 0 0;font-size:12.5px;line-height:1.5;color:var(--dsw-alias-label-secondary)}',
        '.dshmws-card{background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);border-radius:10px;padding:14px 16px;display:flex;flex-direction:column;gap:10px}',
        '.dshmws-card-head{display:flex;flex-direction:column;gap:2px}',
        '.dshmws-card-title{margin:0;font-size:13.5px;font-weight:650;color:var(--dsw-alias-label-primary)}',
        '.dshmws-card-hint{margin:0;font-size:12px;line-height:1.5;color:var(--dsw-alias-label-secondary)}',
        '.dshmws-row{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:8px;margin:0 -8px;border-bottom:1px solid var(--dsw-alias-border-l1);border-radius:8px;transition:background .12s ease}',
        '.dshmws-row:last-child{border-bottom:none}',
        '.dshmws-radio{appearance:auto;accent-color:var(--dsw-alias-state-business-primary);flex:none;width:14px;height:14px;margin:0;cursor:pointer}',
        '.dshmws-radio:disabled{cursor:default;opacity:.45}',
        '.dshmws-name{font-size:13px;font-weight:550;color:var(--dsw-alias-label-primary)}',
        '.dshmws-badge{flex:none;font-size:10.5px;font-weight:600;line-height:1;padding:3px 8px;border-radius:999px;background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 14%,transparent);color:var(--dsw-alias-state-success-primary)}',
        '.dshmws-badge.off{background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-tertiary)}',
        '.dshmws-btn{border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:7px 14px;font-size:12.5px;font-weight:600;font-family:inherit;cursor:pointer;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);transition:background .15s ease}',
        '.dshmws-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}',
        '.dshmws-btn:disabled{opacity:.55;cursor:default}',
        '.dshmws-btn:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:2px}',
        '.dshmws-error{font-size:12.5px;color:var(--dsw-alias-state-error-primary)}',
        '.dshmws-sk{height:30px;border-radius:8px;background:linear-gradient(100deg,var(--dsw-alias-bg-layer-2) 40%,var(--dsw-alias-interactive-bg-hover) 50%,var(--dsw-alias-bg-layer-2) 60%);background-size:200% 100%;animation:dshmwsShimmer 1.2s ease-in-out infinite}',
        '@keyframes dshmwsShimmer{to{background-position:-200% 0}}',
        '@media (prefers-reduced-motion:reduce){.dshmws-trigger,.dshmws-chevron,.dshmws-item,.dshmws-row{transition:none}.dshmws-sk,.dshmws-spin{animation:none}}',
    ]
    if (typeof document !== 'undefined' && !document.querySelector('style[data-dshmws-styles]')) {
      var styleEl = document.createElement('style')
      styleEl.setAttribute('data-dshmws-styles', '1')
      styleEl.textContent = STYLES.join('')
      document.head.appendChild(styleEl)
    }

    // -----------------------------------------------------------------------
    // i18n. The host locale service enforces zh/en key parity; every key below
    // exists in BOTH dicts.
    // -----------------------------------------------------------------------
    var NS = 'myWorkspace'

    function resolveBrowserLocale() {
      try {
        return (navigator.language || 'en').toLowerCase().startsWith('zh') ? 'zh' : 'en'
      } catch { return 'en' }
    }

    function makeT(dict, locale) {
      return function (key) {
        var table = dict[locale] || dict.en
        return Object.prototype.hasOwnProperty.call(table, key) ? table[key] : key
      }
    }

    var STRINGS = {
      en: {
        sectionLabel: 'Workspace',
        sectionHint: 'Open the current session\u2019s project root in your editor, a terminal, or the file manager \u2014 one click away.',
        cardTitle: 'Quick actions',
        cardHint: 'Every session header gains an \u201cOpen workspace\u201d button: launch any detected editor/IDE, terminal, or file manager at the current session\u2019s project root, or copy its path to the clipboard.',
        defaultTargetLabel: 'Default opener',
        defaultTargetHint: 'Marked with a dot in the quick-actions menu.',
        noneOption: 'None',
        launchersCardTitle: 'Detected launchers',
        launchersCardHint: 'Probed from this machine\u2019s PATH. Results are cached briefly; rescan after installing a new tool.',
        available: 'Available',
        unavailable: 'Not found',
        refreshScan: 'Rescan',
        scanning: 'Scanning\u2026',
        loading: 'Loading\u2026',
        retry: 'Retry',
        loadFailed: 'Could not read the launcher state.',
        saveFailed: 'Could not save the preference.',
        groupIde: 'Editors & IDEs',
        groupTerminal: 'Terminal',
        groupFiles: 'Files',
        actionsTitle: 'Open workspace',
        copyPath: 'Copy path',
        copied: 'Copied',
        copyFailed: 'Copy failed',
        openFailed: 'Open failed',
        noLaunchers: 'No supported launcher found on PATH.',
        openRowLabel: 'Open workspace\u2026',
        workspaceNotFound: 'Workspace path not found.',
      },
      zh: {
        sectionLabel: '\u5de5\u4f5c\u533a',
        sectionHint: '\u5728\u7f16\u8f91\u5668\u3001\u7ec8\u7aef\u6216\u6587\u4ef6\u7ba1\u7406\u5668\u4e2d\u4e00\u952e\u6253\u5f00\u5f53\u524d\u4f1a\u8bdd\u7684\u9879\u76ee\u6839\u76ee\u5f55\u3002',
        cardTitle: '\u5feb\u6377\u64cd\u4f5c',
        cardHint: '\u6bcf\u4e2a\u4f1a\u8bdd\u9875\u5934\u90fd\u4f1a\u51fa\u73b0\u201c\u6253\u5f00\u5de5\u4f5c\u533a\u201d\u6309\u94ae\uff1a\u5728\u68c0\u6d4b\u5230\u7684\u7f16\u8f91\u5668 / IDE\u3001\u7ec8\u7aef\u6216\u6587\u4ef6\u7ba1\u7406\u5668\u4e2d\u6253\u5f00\u5f53\u524d\u9879\u76ee\u6839\u76ee\u5f55\uff0c\u6216\u590d\u5236\u5176\u8def\u5f84\u3002',
        defaultTargetLabel: '\u9ed8\u8ba4\u6253\u5f00\u65b9\u5f0f',
        defaultTargetHint: '\u5728\u5feb\u6377\u83dc\u5355\u4e2d\u4ee5\u5706\u70b9\u6807\u8bb0\u3002',
        noneOption: '\u4e0d\u8bbe\u7f6e',
        launchersCardTitle: '\u68c0\u6d4b\u5230\u7684\u542f\u52a8\u5668',
        launchersCardHint: '\u901a\u8fc7 PATH \u63a2\u6d4b\u672c\u673a\u53ef\u7528\u5de5\u5177\uff1b\u7ed3\u679c\u77ed\u6682\u7f13\u5b58\uff0c\u88c5\u65b0\u5de5\u5177\u540e\u53ef\u624b\u52a8\u91cd\u626b\u3002',
        available: '\u53ef\u7528',
        unavailable: '\u672a\u627e\u5230',
        refreshScan: '\u91cd\u65b0\u626b\u63cf',
        scanning: '\u626b\u63cf\u4e2d\u2026',
        loading: '\u52a0\u8f7d\u4e2d\u2026',
        retry: '\u91cd\u8bd5',
        loadFailed: '\u8bfb\u53d6\u542f\u52a8\u5668\u72b6\u6001\u5931\u8d25\u3002',
        saveFailed: '\u4fdd\u5b58\u504f\u597d\u5931\u8d25\u3002',
        groupIde: '\u7f16\u8f91\u5668\u4e0e IDE',
        groupTerminal: '\u7ec8\u7aef',
        groupFiles: '\u6587\u4ef6\u7ba1\u7406\u5668',
        actionsTitle: '\u6253\u5f00\u5de5\u4f5c\u533a',
        copyPath: '\u590d\u5236\u8def\u5f84',
        copied: '\u5df2\u590d\u5236',
        copyFailed: '\u590d\u5236\u5931\u8d25',
        openFailed: '\u6253\u5f00\u5931\u8d25',
        noLaunchers: '\u672a\u5728 PATH \u4e2d\u627e\u5230\u652f\u6301\u7684\u542f\u52a8\u5668\u3002',
        openRowLabel: '\u6253\u5f00\u5de5\u4f5c\u533a\u2026',
        workspaceNotFound: '\u672a\u627e\u5230\u8be5\u5de5\u4f5c\u533a\u7684\u8def\u5f84\u3002',
      },
    }

    // -----------------------------------------------------------------------
    // Host API
    // -----------------------------------------------------------------------

    var STATE_TTL_MS = 15000

    function getState() {
      return fetch('/dsh-my-workspace/state', { credentials: 'same-origin' })
        .then(function (res) {
          if (!res.ok) throw new Error('HTTP ' + res.status)
          return res.json()
        })
    }

    function getWorkspaces() {
      return fetch('/dsh-my-workspace/workspaces', { credentials: 'same-origin' })
        .then(function (res) {
          if (!res.ok) throw new Error('HTTP ' + res.status)
          return res.json()
        })
    }

    function postJson(path, body) {
      return fetch(path, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }).then(function (res) {
        return res.json().catch(function () { return {} }).then(function (data) {
          if (!res.ok) throw new Error(data && data.error ? data.error : 'HTTP ' + res.status)
          return data
        })
      })
    }

    function openTarget(target, path) {
      return postJson('/dsh-my-workspace/open', { target: target, path: path })
    }

    function saveSettings(defaultTarget) {
      return postJson('/dsh-my-workspace/settings', { defaultTarget: defaultTarget })
    }

    /** Clipboard write with an execCommand fallback for older engines. */
    function copyText(text) {
      if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        return navigator.clipboard.writeText(text).catch(function () { return copyTextFallback(text) })
      }
      return Promise.resolve(copyTextFallback(text))
    }

    function copyTextFallback(text) {
      var area = document.createElement('textarea')
      area.value = text
      area.setAttribute('readonly', '')
      area.style.position = 'fixed'
      area.style.opacity = '0'
      document.body.appendChild(area)
      area.select()
      var ok = false
      try { ok = document.execCommand('copy') } catch { ok = false }
      document.body.removeChild(area)
      if (!ok) throw new Error('copy rejected')
      return text
    }

    // -----------------------------------------------------------------------
    // Icons (inline SVG, currentColor)
    // -----------------------------------------------------------------------

    var ICONS = {
      folder: 'M3 5.5A1.5 1.5 0 0 1 4.5 4h4l1.6 1.8h7.4A1.5 1.5 0 0 1 19 7.3V16a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 3 16V5.5Z',
      chevron: 'M4.7 7.3 10 12.6l5.3-5.3 1.4 1.4-6.7 6.7L3.3 8.7z',
      ide: 'M4 4h12a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Zm1 2v8h10V6H5Zm1.6 1.5 2 2-2 2-1.1-1 1-1-1-1 1.1-1ZM20 8h1v9.5a1.5 1.5 0 0 1-1.5 1.5H9v-1h10.5a.5.5 0 0 0 .5-.5V8Z',
      terminal: 'M3 4h14a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Zm1.5 2.6 2.6 2.65-2.6 2.65 1.06 1.06L9.28 9.25 4.56 4.54 4.5 4.6ZM10 12.5h6V14h-6v-1.5Z',
      files: 'M4 3h6l1.5 1.8H18A1.5 1.5 0 0 1 19.5 6v3h-15l-1.3 8.2A1.5 1.5 0 0 0 4.7 19h12.9a1.5 1.5 0 0 0 1.48-1.26L20.5 9.5V6a1.5 1.5 0 0 0-1.5-1.5h-6.6L11 3H4Z',
      copy: 'M8 3h9a1 1 0 0 1 1 1v9h-1.5V4.5H8V3ZM4.5 6.5h9a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1v-10a1 1 0 0 1 1-1Zm.5 1.5v9h8V8H5Z',
      check: 'M9.3 15.9 5.2 11.8l1.06-1.06 3.04 3.04 8.44-8.44 1.06 1.06z',
      external: 'M13 4h7v7h-1.5V6.56l-7.72 7.72-1.06-1.06 7.72-7.72H13V4ZM5.5 6H10v1.5H6.5v11h11V14H19v4.5a1 1 0 0 1-1 1h-12.5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1Z',
    }

    function icon(name) {
      return createElement('svg', {
        viewBox: '0 0 20 20',
        fill: 'currentColor',
        'aria-hidden': 'true',
      }, createElement('path', { d: ICONS[name], fillRule: 'evenodd', clipRule: 'evenodd' }))
    }

    var GROUP_ORDER = ['ide', 'terminal', 'files']
    var GROUP_ICON = { ide: 'ide', terminal: 'terminal', files: 'files' }

    function groupKey(group, t) {
      if (group === 'ide') return t('groupIde')
      if (group === 'terminal') return t('groupTerminal')
      return t('groupFiles')
    }

    // -----------------------------------------------------------------------
    // Session header quick actions: trigger button + portaled popover menu
    // -----------------------------------------------------------------------

    function Menu(props) {
      var t = props.t
      var cwd = props.cwd
      var onClose = props.onClose
      var anchor = props.anchorRect
      var state = props.state
      var loading = props.loading
      var error = props.error
      var onReload = props.onReload
      var defaultTarget = props.defaultTarget

      var menuRef = useRef(null)
      var posRef = useRef(null)
      var _busy = useState(null)
      var busy = _busy[0]
      var setBusy = _busy[1]
      var _copied = useState(false)
      var copied = _copied[0]
      var setCopied = _copied[1]
      var _actionError = useState(null)
      var actionError = _actionError[0]
      var setActionError = _actionError[1]

      // Position once measured: prefer below the anchor, flip up when the
      // menu would leave the viewport.
      useLayoutEffect(function () {
        var el = menuRef.current
        if (!el || !anchor) return
        var h = el.offsetHeight || 280
        var w = el.offsetWidth || 240
        var margin = 8
        var left = Math.min(Math.max(margin, anchor.left), Math.max(margin, window.innerWidth - w - margin))
        var top = anchor.bottom + 6
        if (top + h > window.innerHeight - margin && anchor.top - h - 6 >= margin) {
          top = anchor.top - h - 6
        }
        posRef.current = { left: left, top: top }
        el.style.left = left + 'px'
        el.style.top = top + 'px'
      }, [anchor, loading, error])

      useEffect(function () {
        function onKey(e) {
          if (e.key === 'Escape') onClose()
        }
        function onDown(e) {
          var el = menuRef.current
          if (!el) return
          if (el.contains(e.target) || (props.triggerEl && props.triggerEl.contains(e.target))) return
          onClose()
        }
        // A scroll anywhere outside the menu invalidates the anchored
        // position — but scrolling inside the menu's own overflow area must
        // not close it.
        function onScroll(e) {
          var el = menuRef.current
          if (el && el.contains(e.target)) return
          onClose()
        }
        document.addEventListener('keydown', onKey)
        document.addEventListener('pointerdown', onDown, true)
        window.addEventListener('resize', onScroll)
        window.addEventListener('scroll', onScroll, true)
        return function () {
          document.removeEventListener('keydown', onKey)
          document.removeEventListener('pointerdown', onDown, true)
          window.removeEventListener('resize', onScroll)
          window.removeEventListener('scroll', onScroll, true)
        }
      }, [onClose, props.triggerEl])

      function run(targetId) {
        setBusy(targetId)
        setActionError(null)
        openTarget(targetId, cwd)
          .then(function () {
            setBusy(null)
            onClose()
          })
          .catch(function (err) {
            setBusy(null)
            setActionError(t('openFailed') + ': ' + (err && err.message ? err.message : err))
          })
      }

      function onCopy() {
        setActionError(null)
        copyText(cwd)
          .then(function () {
            setCopied(true)
            setTimeout(function () { setCopied(false) }, 1200)
          })
          .catch(function () {
            setActionError(t('copyFailed'))
          })
      }

      var groups = []
      var targets = state && Array.isArray(state.targets) ? state.targets : []
      var availableTargets = targets.filter(function (t2) { return t2.available })
      GROUP_ORDER.forEach(function (group) {
        var items = availableTargets.filter(function (t2) { return t2.group === group })
        if (items.length > 0) groups.push({ group: group, items: items })
      })

      return ReactDOM.createPortal(
        createElement('div', {
          ref: menuRef,
          className: 'dshmws-menu',
          role: 'menu',
          'aria-label': t('actionsTitle'),
          style: posRef.current ? { left: posRef.current.left + 'px', top: posRef.current.top + 'px', visibility: 'visible' } : { visibility: 'hidden' },
        },
          cwd ? createElement('span', { className: 'dshmws-path-line', title: cwd }, cwd) : null,
          loading && !state ? createElement('div', { className: 'dshmws-menu-empty' }, t('loading')) : null,
          error && !state ? createElement('div', { className: 'dshmws-error-line' },
            error,
            createElement('button', { type: 'button', className: 'dshmws-item', onClick: onReload, style: { width: 'auto', display: 'inline-flex', marginLeft: 8 } }, t('retry')),
          ) : null,
          !loading && !error && groups.length === 0 ? createElement('div', { className: 'dshmws-menu-empty' }, t('noLaunchers')) : null,
          groups.map(function (entry, gi) {
            var nodes = [
              gi > 0 ? createElement('div', { key: 'div-' + entry.group, className: 'dshmws-divider' }) : null,
              createElement('div', { key: 'g-' + entry.group, className: 'dshmws-group' }, groupKey(entry.group, t)),
            ]
            entry.items.forEach(function (target) {
              nodes.push(createElement('button', {
                key: target.id,
                type: 'button',
                role: 'menuitem',
                className: 'dshmws-item',
                disabled: busy !== null,
                onClick: function () { run(target.id) },
              },
                icon(GROUP_ICON[target.group] || 'ide'),
                createElement('span', { className: 'dshmws-item-name' }, target.label),
                busy === target.id ? createElement('span', { className: 'dshmws-spin', 'aria-hidden': 'true' }) : null,
                defaultTarget === target.id && busy !== target.id ? createElement('span', { className: 'dshmws-default-dot', title: t('defaultTargetLabel') }) : null,
              ))
            })
            return createElement(React.Fragment, { key: entry.group }, nodes)
          }),
          groups.length > 0 ? createElement('div', { className: 'dshmws-divider' }) : null,
          createElement('button', {
            type: 'button',
            role: 'menuitem',
            className: 'dshmws-item',
            onClick: onCopy,
          },
            icon(copied ? 'check' : 'copy'),
            createElement('span', { className: 'dshmws-item-name' + (copied ? ' dshmws-ok-mark' : '') }, copied ? t('copied') : t('copyPath')),
          ),
          actionError ? createElement('div', { className: 'dshmws-error-line' }, actionError) : null,
          props.externalNotice ? createElement('div', { className: 'dshmws-error-line' }, props.externalNotice) : null,
        ),
        document.body,
      )
    }

    function WorkspaceMenuButton(props) {
      var sessionId = props.sessionId
      var useSessions = props.useSessions
      var t = props.t || makeT(STRINGS, resolveBrowserLocale())

      var cwd = undefined
      if (typeof useSessions === 'function' && typeof sessionId === 'string') {
        cwd = useSessions(function (state) {
          var summary = state && state.byId ? state.byId[sessionId] : null
          return summary && typeof summary.cwd === 'string' ? summary.cwd : null
        })
      }

      var openState = useState(false)
      var open = openState[0]
      var setOpen = openState[1]
      var anchorState = useState(null)
      var anchorRect = anchorState[0]
      var setAnchorRect = anchorState[1]
      var triggerRef = useRef(null)

      var dataState = useState({ status: 'idle', state: null, error: null })
      var data = dataState[0]
      var setData = dataState[1]

      var load = useCallback(function (force) {
        setData(function (prev) {
          if (!force && prev.status === 'ready' && Date.now() - prev.at < STATE_TTL_MS) return prev
          return { status: prev.state ? 'ready' : 'loading', state: prev.state, error: null, at: prev.at }
        })
        getState()
          .then(function (next) {
            setData({ status: 'ready', state: next, error: null, at: Date.now() })
          })
          .catch(function (err) {
            setData(function (prev) {
              return { status: 'error', state: prev.state, error: String(err && err.message ? err.message : err), at: Date.now() }
            })
          })
      }, [])

      function toggle() {
        if (!open) {
          var rect = triggerRef.current ? triggerRef.current.getBoundingClientRect() : null
          setAnchorRect(rect ? { left: rect.left, top: rect.top, bottom: rect.bottom } : null)
          load(false)
          setOpen(true)
        } else {
          setOpen(false)
        }
      }

      if (!cwd) return null

      return createElement('div', { className: 'dshmws-root' },
        createElement('button', {
          ref: triggerRef,
          type: 'button',
          className: 'dshmws-trigger',
          'aria-haspopup': 'menu',
          'aria-expanded': open ? 'true' : 'false',
          'aria-label': t('actionsTitle'),
          title: cwd,
          onClick: toggle,
        },
          icon('folder'),
          icon('chevron'),
        ),
        open && anchorRect ? createElement(Menu, {
          t: t,
          cwd: cwd,
          anchorRect: anchorRect,
          triggerEl: triggerRef.current,
          state: data.state,
          loading: data.status === 'loading',
          error: data.error,
          defaultTarget: data.state && data.state.settings ? data.state.settings.defaultTarget : null,
          onReload: function () { load(true) },
          onClose: function () { setOpen(false) },
        }) : null,
      )
    }

    // -----------------------------------------------------------------------
    // Settings section: default launcher + detection overview
    // -----------------------------------------------------------------------

    function TargetRow(props) {
      var target = props.target
      return createElement('div', { className: 'dshmws-row' },
        createElement('input', {
          type: 'radio',
          name: props.radioName,
          className: 'dshmws-radio',
          checked: props.checked,
          disabled: !target.available || props.busy,
          onChange: props.onChoose,
          'aria-label': target.label,
        }),
        createElement('span', { className: 'dshmws-name' }, target.label),
        target.id === null ? null : createElement('span', { className: 'dshmws-badge' + (target.available ? '' : ' off') },
          target.available ? props.t('available') : props.t('unavailable')),
      )
    }

    function WorkspaceSettingsSection(props) {
      var t = props.t || makeT(STRINGS, resolveBrowserLocale())
      var dataState = useState({ status: 'loading', state: null, error: null })
      var data = dataState[0]
      var setData = dataState[1]
      var savingState = useState(false)
      var saving = savingState[0]
      var setSaving = savingState[1]
      var saveErrState = useState(null)
      var saveError = saveErrState[0]
      var setSaveError = saveErrState[1]

      var load = useCallback(function () {
        setData({ status: 'loading', state: null, error: null })
        getState()
          .then(function (next) { setData({ status: 'ready', state: next, error: null }) })
          .catch(function (err) {
            setData(function (prev) {
              return { status: 'error', state: prev.state, error: String(err && err.message ? err.message : err) }
            })
          })
      }, [])

      useEffect(function () { load() }, [load])

      // Re-scan when the tab becomes visible again (a new tool may have been
      // installed since the last visit).
      useEffect(function () {
        function onVisible() { if (document.visibilityState === 'visible') load() }
        document.addEventListener('visibilitychange', onVisible)
        return function () { document.removeEventListener('visibilitychange', onVisible) }
      }, [load])

      function choose(targetId) {
        setSaving(true)
        setSaveError(null)
        saveSettings(targetId)
          .then(function () {
            setSaving(false)
            setData(function (prev) {
              var next = prev.state ? JSON.parse(JSON.stringify(prev.state)) : null
              if (next && next.settings) next.settings.defaultTarget = targetId
              return { status: 'ready', state: next, error: null }
            })
          })
          .catch(function (err) {
            setSaving(false)
            setSaveError(t('saveFailed') + ' ' + String(err && err.message ? err.message : err))
          })
      }

      var targets = data.state && Array.isArray(data.state.targets) ? data.state.targets : []
      var defaultTarget = data.state && data.state.settings ? data.state.settings.defaultTarget : null

      return createElement('div', { className: 'dshmws-section' },
        createElement('header', null,
          createElement('h2', { className: 'dshmws-title' }, t('sectionLabel')),
          createElement('p', { className: 'dshmws-subtitle' }, t('sectionHint')),
        ),
        createElement('section', { className: 'dshmws-card' },
          createElement('div', { className: 'dshmws-card-head' },
            createElement('h3', { className: 'dshmws-card-title' }, t('cardTitle')),
            createElement('p', { className: 'dshmws-card-hint' }, t('cardHint')),
          ),
        ),
        createElement('section', { className: 'dshmws-card' },
          createElement('div', { className: 'dshmws-card-head' },
            createElement('h3', { className: 'dshmws-card-title' }, t('launchersCardTitle')),
            createElement('p', { className: 'dshmws-card-hint' }, t('launchersCardHint')),
          ),
          createElement('div', null,
            createElement('button', {
              type: 'button',
              className: 'dshmws-btn',
              disabled: data.status === 'loading',
              onClick: function () { load() },
            },
              data.status === 'loading' ? createElement('span', { className: 'dshmws-spin', style: { marginRight: 6 } }) : null,
              data.status === 'loading' ? t('scanning') : t('refreshScan'),
            ),
          ),
          data.status === 'error' ? createElement('div', { className: 'dshmws-error' },
            t('loadFailed'),
            createElement('button', { type: 'button', className: 'dshmws-btn', style: { marginLeft: 8 }, onClick: load }, t('retry')),
          ) : null,
          data.status === 'loading' ? createElement(React.Fragment, null,
            createElement('div', { className: 'dshmws-sk' }),
            createElement('div', { className: 'dshmws-sk', style: { width: '82%' } }),
          ) : null,
          data.status === 'ready' ? createElement('div', null,
            createElement('div', { className: 'dshmws-group' }, t('defaultTargetLabel')),
            createElement(TargetRow, {
              target: { id: null, label: t('noneOption'), available: true },
              radioName: 'dshmws-default',
              checked: defaultTarget === null,
              busy: saving,
              t: t,
              onChoose: function () { choose(null) },
            }),
            GROUP_ORDER.map(function (group) {
              var items = targets.filter(function (t2) { return t2.group === group })
              if (items.length === 0) return null
              return createElement('div', { key: group },
                items.map(function (target) {
                  return createElement(TargetRow, {
                    key: target.id,
                    target: target,
                    radioName: 'dshmws-default',
                    checked: defaultTarget === target.id,
                    busy: saving,
                    t: t,
                    onChoose: function () { choose(target.id) },
                  })
                }),
              )
            }),
          ) : null,
          saveError ? createElement('div', { className: 'dshmws-error' }, saveError) : null,
        ),
      )
    }

    // -----------------------------------------------------------------------
    // Sidebar workspace rows: an "open" button beside the hover-revealed
    // kebab + new-session buttons of every project row.
    //
    // The workspace browser ships no extension slot, so this follows the
    // house DOM-patch pattern (dsh-restart's nav glyph, dsh-team): a
    // MutationObserver sweeps project rows (`div[role="treeitem"]
    // [aria-expanded]`) and appends a marked ghost icon button into each
    // `rowActions` cluster that hosts at least two buttons (real workspace
    // rows carry kebab + plus; the ungrouped bucket carries only plus).
    // Clicking never reaches the row's own expand toggle. The vanilla button
    // only dispatches (label, anchor rect) on a module bus; all React
    // rendering happens in the shell.overlay occupant below.
    // -----------------------------------------------------------------------

    var MARK = 'data-dshmws-open'
    var rowMenuBus = { open: null }

    function svgIcon(name) {
      var holder = document.createElement('span')
      holder.innerHTML = '<svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path d="' +
        ICONS[name] + '" fill-rule="evenodd" clip-rule="evenodd"></path></svg>'
      return holder.firstChild
    }

    /** Match a sidebar row label to its workspace path: exact title first,
      * then unique path-basename fallback. Null when nothing matches. */
    function resolveWorkspacePath(label, workspaces) {
      if (typeof label !== 'string' || label === '' || !Array.isArray(workspaces)) return null
      var byTitle = workspaces.filter(function (w) { return w && w.title === label })
      if (byTitle.length > 0) return byTitle[0].path || null
      var base = label.replace(/[\\/]+$/, '').split(/[\\/]/).pop()
      var byBase = workspaces.filter(function (w) {
        if (!w || typeof w.path !== 'string') return false
        var p = w.path.replace(/[\\/]+$/, '').split(/[\\/]/).pop()
        return p === base || p === label
      })
      return byBase.length > 0 ? byBase[0].path : null
    }

    function mountRowButtons(t) {
      if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') {
        return function () {}
      }

      function inject(row) {
        var containers = row.querySelectorAll('span[class*="rowActions"]')
        var container = containers.length > 0 ? containers[containers.length - 1] : null
        if (!container) return
        if (container.querySelector('[' + MARK + ']')) return
        // Real workspace rows reveal kebab (menu) + plus; the ungrouped
        // bucket renders only the plus and has no path behind it.
        if (container.querySelectorAll('button').length < 2) return
        var btn = document.createElement('button')
        btn.type = 'button'
        btn.className = 'dshmws-rowbtn'
        btn.setAttribute(MARK, '1')
        btn.setAttribute('aria-label', t('openRowLabel'))
        btn.title = t('openRowLabel')
        try { btn.appendChild(svgIcon('folder')) } catch (e) { /* non-DOM env */ }
        btn.addEventListener('click', function (e) {
          e.stopPropagation()
          var labelEl = row.querySelector('[class*="title"]')
          var label = labelEl ? String(labelEl.textContent || '').trim() : ''
          var r = btn.getBoundingClientRect()
          if (rowMenuBus.open) rowMenuBus.open(label, { left: r.left, top: r.top, bottom: r.bottom }, btn)
        })
        container.appendChild(btn)
      }

      var scheduled = false
      function sweep() {
        scheduled = false
        try {
          var rows = document.querySelectorAll('div[role="treeitem"][aria-expanded]')
          for (var i = 0; i < rows.length; i++) inject(rows[i])
        } catch (e) { /* transient DOM states */ }
      }
      function schedule() {
        if (scheduled) return
        scheduled = true
        requestAnimationFrame(sweep)
      }

      sweep()
      var observer = new MutationObserver(schedule)
      observer.observe(document.body, { childList: true, subtree: true })

      return function () {
        observer.disconnect()
        try {
          var mine = document.querySelectorAll('[' + MARK + ']')
          for (var i = 0; i < mine.length; i++) {
            if (mine[i].parentNode) mine[i].parentNode.removeChild(mine[i])
          }
        } catch (e) { /* document gone */ }
      }
    }

    /** Frame-wide overlay occupant: resolves a clicked row to its workspace
      * path and hosts the shared launcher Menu anchored at the row button. */
    function WorkspaceRowOverlay(props) {
      var t = props.t || makeT(STRINGS, resolveBrowserLocale())
      var openState = useState(null)
      var openReq = openState[0]
      var setOpenReq = openState[1]
      var dataState = useState({ status: 'idle', state: null, error: null, cwd: null })
      var data = dataState[0]
      var setData = dataState[1]
      var openReqRef = useRef(null)
      openReqRef.current = openReq

      useEffect(function () {
        rowMenuBus.open = function (label, rect, triggerEl) {
          var current = openReqRef.current
          // Second click on the same row button toggles the menu closed.
          if (current && current.triggerEl === triggerEl) {
            setOpenReq(null)
            return
          }
          setData({ status: 'loading', state: null, error: null, cwd: null })
          setOpenReq({ label: label, rect: rect, triggerEl: triggerEl, at: Date.now() })
        }
        return function () { rowMenuBus.open = null }
      }, [])

      useEffect(function () {
        if (!openReq) return
        var alive = true
        Promise.all([getState(), getWorkspaces()])
          .then(function (results) {
            if (!alive) return
            var state = results[0]
            var wsList = results[1] && Array.isArray(results[1].workspaces) ? results[1].workspaces : []
            setData({
              status: 'ready',
              state: state,
              error: null,
              cwd: resolveWorkspacePath(openReq.label, wsList),
            })
          })
          .catch(function (err) {
            if (!alive) return
            setData({ status: 'error', state: null, error: String(err && err.message ? err.message : err), cwd: null })
          })
        return function () { alive = false }
      }, [openReq])

      if (!openReq) return null

      return createElement(Menu, {
        t: t,
        cwd: data.cwd,
        anchorRect: openReq.rect,
        triggerEl: openReq.triggerEl,
        state: data.state,
        loading: data.status === 'loading',
        error: data.error,
        defaultTarget: data.state && data.state.settings ? data.state.settings.defaultTarget : null,
        externalNotice: data.status !== 'loading' && !data.cwd && !data.error ? t('workspaceNotFound') : null,
        onReload: function () { setOpenReq({ label: openReq.label, rect: openReq.rect, triggerEl: openReq.triggerEl, at: Date.now() }) },
        onClose: function () { setOpenReq(null) },
      })
    }

    // -----------------------------------------------------------------------
    // Plugin entry
    // -----------------------------------------------------------------------

    function apply(ctx) {
      var slots = ctx.get('slots')
      var locale = ctx.get('locale')
      var t

      if (locale && typeof locale.register === 'function') {
        try {
          ctx.effect(function () { return locale.register(NS, STRINGS) }, 'dsh-my-workspace: dictionaries')
          t = locale.bind(NS)
        } catch (e) {
          t = makeT(STRINGS, resolveBrowserLocale())
        }
      } else {
        t = makeT(STRINGS, resolveBrowserLocale())
      }

      slots.inject('conversation.session.header.actions', function () {
        return slots.register({
          name: 'conversation.session.header.actions',
          id: 'workspace-actions',
          order: 8,
          locale: NS,
        }, WorkspaceMenuButton)
      })

      slots.inject('settings.section', function () {
        return slots.register({
          name: 'settings.section',
          id: 'my-workspace',
          order: 90,
          label: function () { return t('sectionLabel') },
          locale: NS,
        }, WorkspaceSettingsSection)
      })

      // Sidebar workspace rows: frame-wide menu overlay + vanilla trigger
      // buttons patched into each project row's hover actions.
      slots.inject('shell.overlay', function () {
        return slots.register({
          name: 'shell.overlay',
          id: 'workspace-row-menu',
          order: 20,
          locale: NS,
        }, WorkspaceRowOverlay)
      })
      ctx.effect(function () { return mountRowButtons(t) }, 'dsh-my-workspace: sidebar row buttons')
    }

    exports.name = 'dsh-my-workspace'
    exports.inject = ['slots', 'locale']
    exports.apply = apply
    exports.styles = STYLES
    exports.strings = STRINGS
    exports.WorkspaceMenuButton = WorkspaceMenuButton
    exports.WorkspaceSettingsSection = WorkspaceSettingsSection
    exports.WorkspaceRowOverlay = WorkspaceRowOverlay
    exports.Menu = Menu
    exports.resolveWorkspacePath = resolveWorkspacePath

    return module.exports
  },
})
