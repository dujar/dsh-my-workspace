# dsh-my-workspace

[中文](README.md)

A [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH) web-GUI plugin: **workspace quick actions**. The session header and every workspace row in the left sidebar carry an "Open" entry that launches the project root in any detected IDE, terminal, or file manager — or copies its path with one click; a `>_` button beside them unfolds a quick terminal that runs shell commands right in the workspace; Settings picks the default opener. Bilingual UI (English/中文, follows the host locale).

## Features

- **Quick terminal (`>_`)** — unfolds a small anchored panel under the header: type a command and press ↵ to run it in the current workspace (via `$SHELL -c`), with output streaming in live. **Closing the panel stops everything still running** (TERM→KILL on the whole process group); end a command with `&` — or flip the bg toggle first — to background it instead: it keeps running after close, the trigger grows a badge dot, and reopening reattaches to its live output. History (↑/↓), drafts, and scrollback live in page memory, so toggling never loses state.
- **Session-header quick actions** — reads the current session's workspace (project root) and opens a menu with:
  - **Editors & IDEs** — auto-probed from this machine's PATH: VS Code, VS Code Insiders, VSCodium, Cursor, Windsurf, Zed, Antigravity, Trae, Kiro, Void, IntelliJ IDEA, PyCharm, WebStorm, CLion, GoLand, Rider, PhpStorm, RubyMine, DataGrip, Fleet, Sublime Text, plus community picks like ZCode / Berd / Orca;
  - **Terminals** — Linux: GNOME Terminal, Konsole, Xfce Terminal, Tilix, Alacritty, kitty, WezTerm, Ghostty; cross-platform: Warp (launched plain with the directory as the child cwd); macOS: Terminal.app and iTerm (via osascript); Windows: Windows Terminal;
  - **File managers** — Linux: xdg-open / Nautilus / Dolphin; macOS: Finder; Windows: Explorer;
  - **Copy path** — writes straight to the browser clipboard (secure localhost context) with a ✓ feedback, no host round-trip.
- **Subdirectories and files, any depth** — the open target is no longer limited to the root: project root, directories nested any number of levels down, or an individual file all work. Behavior adapts per launcher kind: editors receive the exact path; terminals sit in the path's nearest directory (a file opens its parent); file managers reveal/select files — macOS `open -R`, Windows `explorer /select,`, Linux via org.freedesktop.FileManager1.ShowItems (gdbus or dbus-send auto-picked), falling back to the parent directory when neither exists.
- **`workspace_open` agent tool** — registers a model tool so you can simply ask "open src/lib/deep/mod.js in Cursor". Parameters: `path` (absolute, required) and `target` (optional launcher id; defaults to your configured default opener, then the first detected IDE). The tool shares one open implementation with the HTTP routes.
- **Sidebar workspace-row "Open" button** — every workspace group row in the left panel gains a 📁 button beside its hover-revealed kebab + new-session buttons: clicking resolves that workspace's durable path (via the host `workspaceRegistry`) and opens the same launcher menu anchored at the row; click the same button again to dismiss. The ungrouped bucket (no path behind it) is left untouched.
- **Default opener** — pick any available launcher as the default under Settings → Workspace; it is marked with a dot in the quick-actions menu.
- **Lazy probing with a cache** — launchers are probed by scanning PATH, cached host-side for 10 s; rescan manually from the settings page after installing a new tool.
- **Safety** — every route reuses the fail-closed same-origin + localhost trust check from dsh-restart / dsh-trader; paths are validated (absolute, existing, a directory) before anything launches; launchers spawn detached with ignored stdio through an argv array — no shell involved, and this process never holds their pipes. The quick terminal accepts only trusted local requests too: commands are typed by the user and run through `$SHELL -c` (which is the point of a terminal), output is ring-buffered at 512 KB per job, concurrent and retained jobs are capped, and unloading the host half reaps every child still running.

## Install

> Requires Node.js 22.19+ and pnpm.

```sh
# local development
dsh plugin --profile web add /path/to/dsh-my-workspace

# or from a published repo
dsh plugin --profile web add github:dujar/dsh-my-workspace
```

Then **restart `dsh web`** and refresh the page. Installing adds `dsh-my-workspace` to the profile's `dsh.profile.bundles`; if not, append it to that array in `$DSH_HOME/profiles/web/package.json` manually and restart.

## Usage

1. Open any session — a 📁 button and a `>_` button appear right of the header title (hidden automatically for blank sessions without a workspace).
2. Click the folder: launchers detected on this machine are grouped by *Editors & IDEs / Terminal / Files*; clicking one opens the project root in it. The full path shows at the top of the menu in monospace.
3. **Copy path** puts the project root on your clipboard.
4. Click `>_` to unfold the quick terminal: type a command and press ↵; Esc or × collapses the panel and stops foreground commands; a trailing `&` (or the bg toggle) sends a command to the background instead — the trigger grows a badge dot and reopening reattaches to the output.
5. Hover any workspace group row in the left panel: a 📁 button appears beside ⋯ and ＋ — click to open that workspace with the same menu (click again to dismiss).
6. Open **Settings → Workspace** to set a default opener (dot-marked in the menu), or **Rescan** after installing new tools.
7. Ask the assistant right in a session — e.g. "open src/lib/deep/mod.js in vscode" or "open this project's docs directory in a terminal" — and it completes the request through the `workspace_open` tool; nested subdirectories and single files included.

## Routes (host half)

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/dsh-my-workspace/state` | Platform, detected launchers (availability + binary path), preferences |
| GET | `/dsh-my-workspace/workspaces` | Registered workspaces as id / title / canonical path leaves (backs the sidebar row buttons) |
| POST | `/dsh-my-workspace/open` | body `{ target, path }`: validates then opens the directory in the target launcher (detached spawn, no shell) |
| POST | `/dsh-my-workspace/settings` | body `{ defaultTarget }`: persists the default launcher to `$DSH_HOME/dsh-my-workspace/settings.json` |
| POST | `/dsh-my-workspace/terminal/run` | body `{ cwd, cmd }`: starts one job via `$SHELL -c cmd` in directory `cwd`; a trailing `&` on `cmd` (or body `background: true`) marks it background; returns `{ job: { id, … } }` |
| GET | `/dsh-my-workspace/terminal/output` | `?id&since`: status plus output bytes past cursor `since`, always cut on UTF-8 character boundaries |
| POST | `/dsh-my-workspace/terminal/kill` | body `{ id }`: SIGTERM to the whole process group, SIGKILL after a 3 s grace |
| GET | `/dsh-my-workspace/terminal/jobs` | Leaf fields of every retained job (backs the badge and reattach-on-reopen) |

## Custom launchers

The launcher catalog lives in `CATALOG` inside `lib/index.js`: each entry carries a stable `id`, a group (`ide` / `terminal` / `files`), a display label, candidate binary names, and an argv builder. Adding support for another tool is one catalog line — e.g. an Emacs daemon:

```js
{ id: 'emacsd', group: 'ide', label: 'Emacs (daemon)', bins: ['emacsclient'], args: (p) => ['-n', p] },
```

Tools that should simply be started *inside* the directory rather than handed it as an argument (Warp-style) take `cwdBased: true` with empty `args` — the directory becomes the child's working directory.

## Development

```sh
npm test        # host-half + browser-half smoke tests (spawn is stubbed)
```

The repo layout matches the other dsh plugins: `lib/index.js` (host HTTP routes), `lib/client.js` (zero-build ModuleLoader browser half), `cordis.patch.yml` (bundle mount patch), `test/`.

## Troubleshooting

- The menu shows "The host half is older than this page — restart dsh web" (or, in older builds, the cryptic `Unexpected token '<'`): the browser half updates on page refresh, but host routes need a process restart. **Restarting dsh web fixes it.** The plugin now detects this mismatch and shows a clear localized message instead of a JSON parse error.
- A sidebar row shows no 📁 button: only true workspace group rows get one (hover reveals both ⋯ and ＋); the ungrouped bucket has no path behind it and is left untouched.
- A background job outliving a page refresh is by design: it lives in the host process — reopen the `>_` panel to reattach; hit Stop, or drop the `&`, when you don't want one left behind.

## License

[MIT](LICENSE)
