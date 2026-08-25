# dsh-my-workspace

A [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH) web-GUI plugin: **workspace quick actions**. Every session header gains an "Open workspace" button that opens the current session's project root in any detected IDE, terminal, or file manager — or copies its path with one click. Bilingual UI (English/中文, follows the host locale).

## Features

- **Session-header quick actions** — reads the current session's workspace (project root) and opens a menu with:
  - **Editors & IDEs** — auto-probed from this machine's PATH: VS Code, VS Code Insiders, VSCodium, Cursor, Windsurf, Zed, IntelliJ IDEA, PyCharm, WebStorm, CLion, GoLand, Rider, PhpStorm, RubyMine, DataGrip, Fleet;
  - **Terminals** — Linux: GNOME Terminal, Konsole, Xfce Terminal, Tilix, Alacritty, kitty, WezTerm; macOS: Terminal.app and iTerm (via osascript); Windows: Windows Terminal;
  - **File managers** — Linux: xdg-open / Nautilus / Dolphin; macOS: Finder; Windows: Explorer;
  - **Copy path** — writes straight to the browser clipboard (secure localhost context) with a ✓ feedback, no host round-trip.
- **Sidebar workspace-row "Open" button** — every workspace group row in the left panel gains a 📁 button beside its hover-revealed kebab + new-session buttons: clicking resolves that workspace's durable path (via the host `workspaceRegistry`) and opens the same launcher menu anchored at the row; click the same button again to dismiss. The ungrouped bucket (no path behind it) is left untouched.
- **Default opener** — pick any available launcher as the default under Settings → Workspace; it is marked with a dot in the quick-actions menu.
- **Lazy probing with a cache** — launchers are probed by scanning PATH, cached host-side for 10 s; rescan manually from the settings page after installing a new tool.
- **Safety** — every route reuses the fail-closed same-origin + localhost trust check from dsh-restart / dsh-trader; paths are validated (absolute, existing, a directory) before anything launches; launchers spawn detached with ignored stdio through an argv array — no shell involved, and this process never holds their pipes.

## Install

> Requires Node.js 22.19+ and pnpm.

```sh
# local development
dsh plugin --profile web add /path/to/dsh-my-workspace

# or from a published repo
dsh plugin --profile web add github:<you>/dsh-my-workspace
```

Then **restart `dsh web`** and refresh the page. Installing adds `dsh-my-workspace` to the profile's `dsh.profile.bundles`; if not, append it to that array in `$DSH_HOME/profiles/web/package.json` manually and restart.

## Usage

1. Open any session — a 📁 button appears right of the header title (hidden automatically for blank sessions without a workspace).
2. Click it: launchers detected on this machine are grouped by *Editors & IDEs / Terminal / Files*; clicking one opens the project root in it. The full path shows at the top of the menu in monospace.
3. **Copy path** puts the project root on your clipboard.
4. Hover any workspace group row in the left panel: a 📁 button appears beside ⋯ and ＋ — click to open that workspace with the same menu (click again to dismiss).
5. Open **Settings → Workspace** to set a default opener (dot-marked in the menu), or **Rescan** after installing new tools.

## Routes (host half)

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/dsh-my-workspace/state` | Platform, detected launchers (availability + binary path), preferences |
| GET | `/dsh-my-workspace/workspaces` | Registered workspaces as id / title / canonical path leaves (backs the sidebar row buttons) |
| POST | `/dsh-my-workspace/open` | body `{ target, path }`: validates then opens the directory in the target launcher (detached spawn, no shell) |
| POST | `/dsh-my-workspace/settings` | body `{ defaultTarget }`: persists the default launcher to `$DSH_HOME/dsh-my-workspace/settings.json` |

## Custom launchers

The launcher catalog lives in `CATALOG` inside `lib/index.js`: each entry carries a stable `id`, a group (`ide` / `terminal` / `files`), a display label, candidate binary names, and an argv builder. Adding support for another tool is one catalog line — e.g. Sublime Text:

```js
{ id: 'sublime', group: 'ide', label: 'Sublime Text', bins: ['subl'], args: (p) => [p] },
```

## Development

```sh
npm test        # host-half + browser-half smoke tests (spawn is stubbed)
```

The repo layout matches the other dsh plugins: `lib/index.js` (host HTTP routes), `lib/client.js` (zero-build ModuleLoader browser half), `cordis.patch.yml` (bundle mount patch), `test/`.

## License

[MIT](LICENSE)
