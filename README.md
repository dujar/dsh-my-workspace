# dsh-my-workspace

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH）web-GUI 插件：**工作区快捷操作**。每个会话页头出现一个「打开工作区」按钮，把当前会话的项目根目录一键在检测到的 IDE / 终端 / 文件管理器中打开，或一键复制路径。中英双语界面（跟随宿主全局语言，zh / en）。

## 功能

- **会话页头快捷按钮** — 读取当前会话的工作区（项目根目录），点开弹出菜单：
  - **编辑器与 IDE** — 自动探测本机 PATH 上可用的启动器：VS Code、VS Code Insiders、VSCodium、Cursor、Windsurf、Zed、IntelliJ IDEA、PyCharm、WebStorm、CLion、GoLand、Rider、PhpStorm、RubyMine、DataGrip、Fleet；
  - **终端** — Linux：GNOME Terminal、Konsole、Xfce Terminal、Tilix、Alacritty、kitty、WezTerm；macOS：Terminal.app 与 iTerm（osascript）；Windows：Windows Terminal；
  - **文件管理器** — Linux：xdg-open / Nautilus / Dolphin；macOS：Finder；Windows：Explorer；
  - **复制路径** — 直接写入浏览器剪贴板（localhost 安全上下文），带「已复制 ✓」反馈，不经宿主往返。
- **左侧工作区行「打开」按钮** — 左侧面板每个工作区分组行在悬停出的操作簇（⋯ 菜单、＋ 新会话）旁多一个 📁 打开按钮：点击即解析该工作区的持久化路径（宿主 `workspaceRegistry`），弹出同样的「打开方式」菜单；再次点击同一按钮收起。未分组桶（背后无路径）不注入。
- **默认打开方式** — 设置 → 工作区 中可将任一可用启动器设为默认；快捷菜单里以圆点标记。
- **按需探测与缓存** — 启动器列表通过扫描 PATH 得到，宿主侧缓存 10 秒；安装新工具后可在设置页手动重新扫描。
- **安全** — 所有路由沿用 dsh-restart / dsh-trader 的 fail-closed 同源 + localhost 信任校验；打开目录前校验绝对路径存在且为目录；启动子进程 detached + stdio ignore，不经过 shell，DSH 进程绝不持有其管道。

## 安装

> 需要 Node.js 22.19+ 与 pnpm。

```sh
# 本地开发
dsh plugin --profile web add /path/to/dsh-my-workspace

# 发布后从远端安装
dsh plugin --profile web add github:<you>/dsh-my-workspace
```

然后**重启 `dsh web`** 并刷新浏览器页面。安装会自动把 `dsh-my-workspace` 加入 profile 的 `dsh.profile.bundles`；若未加入，请手动追加到 `$DSH_HOME/profiles/web/package.json` 的该数组并重启。

## 使用

1. 打开任意会话，页头标题右侧出现 📁 按钮（无工作区的空白会话自动隐藏）。
2. 点按钮展开菜单：按「编辑器与 IDE / 终端 / 文件管理器」分组列出本机检测到的启动器，点击即在项目根目录打开；顶部以等宽字体显示完整路径。
3. **复制路径** 一键把项目根目录写入剪贴板。
4. 左侧面板把鼠标悬停到任意工作区分组行：⋯ 与 ＋ 旁边出现 📁 按钮，点击即用同样的菜单在该工作区打开（再点一次收起）。
5. 打开 **设置 → 工作区** 可将常用启动器设为默认（菜单中圆点标记），或安装新工具后 **重新扫描**。

## 路由（宿主半）

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/dsh-my-workspace/state` | 平台、探测到的启动器列表（含可用性与二进制路径）、偏好设置 |
| GET | `/dsh-my-workspace/workspaces` | 已注册工作区的 id / 标题 / 规范化路径（仅叶子字段，供侧栏行按钮解析） |
| POST | `/dsh-my-workspace/open` | body `{ target, path }`：校验后在目标启动器中打开该目录（detached spawn，无 shell） |
| POST | `/dsh-my-workspace/settings` | body `{ defaultTarget }`：持久化默认启动器到 `$DSH_HOME/dsh-my-workspace/settings.json` |

## 自定义启动器

启动器目录内置于 `lib/index.js` 的 `CATALOG`：每项含稳定 `id`、分组（`ide` / `terminal` / `files`）、显示名、候选二进制名与参数构造器。新增一个支持只需加一条目录项 —— 例如 Sublime Text：

```js
{ id: 'sublime', group: 'ide', label: 'Sublime Text', bins: ['subl'], args: (p) => [p] },
```

## 开发

```sh
npm test        # 宿主半 + 浏览器半冒烟测试（spawn 已打桩，不会真启动任何程序）
```

仓库结构与其他 dsh 插件一致：`lib/index.js`（宿主半 HTTP 路由）、`lib/client.js`（零构建 ModuleLoader 浏览器半）、`cordis.patch.yml`（bundle 挂载补丁）、`test/`。

## License

[MIT](LICENSE)
