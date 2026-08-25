# dsh-my-workspace

[English](README.en.md)

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH）web-GUI 插件：**工作区快捷操作**。会话页头与左侧工作区分组行各有一个「打开」入口，把项目根目录一键在检测到的 IDE / 终端 / 文件管理器中打开，或一键复制路径；页头还有一枚 `>_` 按钮展开快捷终端，就地运行 shell 命令；设置页可指定默认打开方式。中英双语界面（跟随宿主全局语言，zh / en）。

## 功能

- **会话页头快捷终端 `>_`** — 页头按钮旁的 `>_` 展开一块锚定小面板：输入命令回车即在当前工作区运行（经 `$SHELL -c`），输出实时流式回显。**关闭面板即终止仍在运行的前台命令**（TERM→KILL 整个进程组）；命令以 `&` 结尾或打开面板右上角的 bg 开关则转入后台——面板关了照常运行，`>_` 按钮亮起圆点徽标，重新打开自动续上输出。历史回溯（↑/↓）、草稿与回显都存在页面内存里，收起再展开不丢状态。
- **会话页头快捷按钮** — 读取当前会话的工作区（项目根目录），点开弹出菜单：
  - **编辑器与 IDE** — 自动探测本机 PATH 上可用的启动器：VS Code、VS Code Insiders、VSCodium、Cursor、Windsurf、Zed、Antigravity、Trae、Kiro、Void、IntelliJ IDEA、PyCharm、WebStorm、CLion、GoLand、Rider、PhpStorm、RubyMine、DataGrip、Fleet、Sublime Text，以及 ZCode / Berd / Orca 等社区新贵；
  - **终端** — Linux：GNOME Terminal、Konsole、Xfce Terminal、Tilix、Alacritty、kitty、WezTerm、Ghostty；跨平台：Warp（以工作目录为子进程 cwd 启动）；macOS：Terminal.app 与 iTerm（osascript）；Windows：Windows Terminal；
  - **文件管理器** — Linux：xdg-open / Nautilus / Dolphin；macOS：Finder；Windows：Explorer；
  - **复制路径** — 直接写入浏览器剪贴板（localhost 安全上下文），带「已复制 ✓」反馈，不经宿主往返。
- **任意深度的子目录与文件** — 打开对象不再限于根目录：项目根、任意层级的子目录、乃至单个文件都行。按启动器类型自适应：编辑器收到精确路径；终端落在该路径所在目录（文件则取其父目录）；文件管理器对文件执行「定位并选中」— macOS `open -R`、Windows `explorer /select,`、Linux 走 org.freedesktop.FileManager1.ShowItems（自动选 gdbus / dbus-send），都不可用时退回打开父目录。
- **Agent 工具 `workspace_open`** — 向会话注册一个模型工具：直接说「用 Cursor 打开 src/lib/deep/mod.js」即可。参数：`path`（绝对路径，必填）、`target`（可选启动器 id，缺省用「默认打开方式」，再退化到第一个检测到的 IDE）。工具与 HTTP 路由共用同一套打开语义。
- **左侧工作区行「打开」按钮** — 左侧面板每个工作区分组行在悬停出的操作簇（⋯ 菜单、＋ 新会话）旁多一个 📁 打开按钮：点击即解析该工作区的持久化路径（宿主 `workspaceRegistry`），弹出同样的「打开方式」菜单；再次点击同一按钮收起。未分组桶（背后无路径）不注入。
- **默认打开方式** — 设置 → 工作区 中可将任一可用启动器设为默认；快捷菜单里以圆点标记。
- **按需探测与缓存** — 启动器列表通过扫描 PATH 得到，宿主侧缓存 10 秒；安装新工具后可在设置页手动重新扫描。
- **安全** — 所有路由沿用 dsh-restart / dsh-trader 的 fail-closed 同源 + localhost 信任校验；打开目录前校验绝对路径存在且为目录；启动子进程 detached + stdio ignore，不经过 shell，DSH 进程绝不持有其管道。快捷终端同样只接受本机可信请求：命令由用户亲手输入、经 `$SHELL -c` 执行（这正是终端的本意），输出按 512 KB 环形缓冲截断，并发运行数与保留任务数均有上限，插件卸载时回收所有仍在运行的子进程。

## 安装

> 需要 Node.js 22.19+ 与 pnpm。

```sh
# 本地开发
dsh plugin --profile web add /path/to/dsh-my-workspace

# 发布后从远端安装
dsh plugin --profile web add github:dujar/dsh-my-workspace
```

然后**重启 `dsh web`** 并刷新浏览器页面。安装会自动把 `dsh-my-workspace` 加入 profile 的 `dsh.profile.bundles`；若未加入，请手动追加到 `$DSH_HOME/profiles/web/package.json` 的该数组并重启。

## 使用

1. 打开任意会话，页头标题右侧出现 📁 按钮和 `>_` 按钮（无工作区的空白会话自动隐藏）。
2. 点按钮展开菜单：按「编辑器与 IDE / 终端 / 文件管理器」分组列出本机检测到的启动器，点击即在项目根目录打开；顶部以等宽字体显示完整路径。
3. **复制路径** 一键把项目根目录写入剪贴板。
4. 点 `>_` 展开快捷终端：输入命令回车运行，输出实时回显；Esc 或 × 收起面板并停止前台命令；命令末尾加 `&`（或先点亮 bg）可转入后台，`>_` 上会出现徽标圆点，重开面板即重新接管。
5. 左侧面板把鼠标悬停到任意工作区分组行：⋯ 与 ＋ 旁边出现 📁 按钮，点击即用同样的菜单在该工作区打开（再点一次收起）。
6. 打开 **设置 → 工作区** 可将常用启动器设为默认（菜单中圆点标记），或安装新工具后 **重新扫描**。
7. 会话里直接吩咐助手，例如「用 vscode 打开 src/lib/deep/mod.js」「在终端里打开这个项目的 docs 目录」— 助手通过 `workspace_open` 工具完成，支持任意深度的子目录与单个文件。

## 路由（宿主半）

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/dsh-my-workspace/state` | 平台、探测到的启动器列表（含可用性与二进制路径）、偏好设置 |
| GET | `/dsh-my-workspace/workspaces` | 已注册工作区的 id / 标题 / 规范化路径（仅叶子字段，供侧栏行按钮解析） |
| POST | `/dsh-my-workspace/open` | body `{ target, path }`：`path` 可为项目根、任意层级子目录或单个文件；校验后按启动器语义打开（detached spawn，无 shell） |
| POST | `/dsh-my-workspace/settings` | body `{ defaultTarget }`：持久化默认启动器到 `$DSH_HOME/dsh-my-workspace/settings.json` |
| POST | `/dsh-my-workspace/terminal/run` | body `{ cwd, cmd }`：在目录 `cwd` 里经 `$SHELL -c cmd` 启动一个任务；`cmd` 以 `&` 结尾（或 body `background: true`）标记后台任务；返回 `{ job: { id, … } }` |
| GET | `/dsh-my-workspace/terminal/output` | `?id&since`：自字节游标 `since` 起的新输出与任务状态（按 UTF-8 字符边界切分，绝不吐半个字符） |
| POST | `/dsh-my-workspace/terminal/kill` | body `{ id }`：对整个进程组先 SIGTERM、宽限 3 s 后 SIGKILL |
| GET | `/dsh-my-workspace/terminal/jobs` | 全部保留任务的叶子字段（供徽标与重开面板时接管） |

## 自定义启动器

启动器目录内置于 `lib/index.js` 的 `CATALOG`：每项含稳定 `id`、分组（`ide` / `terminal` / `files`）、显示名、候选二进制名与参数构造器。新增一个支持只需加一条目录项 —— 例如 Emacs daemon：

```js
{ id: 'emacsd', group: 'ide', label: 'Emacs (daemon)', bins: ['emacsclient'], args: (p) => ['-n', p] },
```

不需要「传路径参数」、只要在目标目录里启动的工具（如 Warp），加 `cwdBased: true` 并让 `args` 返回空数组即可 —— 目录会作为子进程的工作目录传入。

## 开发

```sh
npm test        # 宿主半 + 浏览器半冒烟测试（spawn 已打桩，不会真启动任何程序）
```

仓库结构与其他 dsh 插件一致：`lib/index.js`（宿主半 HTTP 路由）、`lib/client.js`（零构建 ModuleLoader 浏览器半）、`cordis.patch.yml`（bundle 挂载补丁）、`test/`。

## 故障排查

- 菜单里出现「宿主半落后于当前页面——请重启 dsh web」（或旧版本的 `Unexpected token '<'`）：浏览器半随页面刷新即更新，宿主半要进程重启才加载新路由——**重启 dsh web 即可**。插件现在会把这种不匹配识别为明确的本地化提示，而不是 JSON 解析错误。
- 侧栏行按钮点了没反应：确认该行是真正的工作区分组行（悬停后同时有 ⋯ 和 ＋）；「未分组」桶背后没有路径，不会注入按钮。
- 后台任务在页面刷新后仍在运行是预期行为：它活在宿主进程里，重开 `>_` 面板即可重新接管输出；不想留就先点 Stop 或关面板前别加 `&`。

## License

[MIT](LICENSE)
