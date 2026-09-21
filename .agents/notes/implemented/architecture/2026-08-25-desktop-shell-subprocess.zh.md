# Agent Note: dsh-desktop 以子进程方式在 Electron 壳下托管 Web GUI

Status: implemented

[English](2026-08-25-desktop-shell-subprocess.md) | 中文

## Problem

仓库的 Web GUI 由 `dsh web` 提供——一个 loopback HTTP 服务器加一个浏览器标签——但没有桌面应用程序。webserver 包自身的文档点名了最终的桌面形态：本壳（浏览器组合装进窗口）与让渲染器完全绕开 HTTP 传输的 `file://` + IPC 桥载体。以朴素方式构建桌面壳，要么把 agent 主干复制成原生代码，要么给随附组合打补丁，两者都会在 Web GUI 演进的第一时间分叉产品表面。

## Decision

`apps/desktop` 是一个 app 包而非插件：一个 Electron 主进程（[`src/main.ts`](../../../../apps/desktop/src/main.ts)）以根 `dsh` 脚本完全相同的源码启动向量——`--import tsx/esm apps/cli/src/bin.ts web --no-open --port 0`——启动既有的 `dsh web` 组合，并把就绪 URL 行（`dsh web: http://127.0.0.1:<port>`，仅在 Loader 树沉降后打印）加载进 BrowserWindow。组合、传输与渲染器均未被触碰：窗口就是普通的 Web GUI，`webPreferences` 全部保持默认，没有 preload，因为桌面壳没有任何需要暴露的原生表面。

承重细节：

- **Electron 二进制即子进程的 Node 运行时。** 向量以 `process.execPath` 加 `ELECTRON_RUN_AS_NODE=1` 运行，宿主子进程的 Node 随固定的 Electron（24.x，满足仓库 `^22.19 || >=24` 的 engines）而非依赖系统 Node。
- **`--expose-internals` 属于向量本身。** vendored Loader 经由 `node-addon-require-builtin` 访问 Node 内部模块 loader，该原生 addon 需要普通 Node 提供而 Electron node 模式不提供的 embedder 槽位（探针：`Unsupported/no-realm`）。loader 本就带有 `--expose-internals` 回退分支（[`vendor/loader/src/internal.ts`](../../../../vendor/loader/src/internal.ts)）；缺失时裸插件名停止解析，树以 `ERR_MODULE_NOT_FOUND` 加载失败。
- **生命周期归属三个挂点。** `window-all-closed` 与 `before-quit` 汇入同一个记忆化的停止（SIGTERM——随附启动器的安静排空——十秒后 SIGKILL）；未经请求而死亡的宿主以携带子进程 stderr 尾部的对话框使桌面壳失败退出。第二个实例聚焦既有窗口。端到端验证：`open` 打包后的 `.app` 拉起五个 Electron 进程加宿主子进程，`quit` 后零进程存活。
- **打包是标记，而非对 harness 的再构建。** `scripts/pack.ts`（`@electron/packager`）只打包主进程构建——桌面壳没有运行时依赖——并把所托管检出记录为一份额外资源。启动时检出从 `DSH_REPO_ROOT`、该标记或模块位置解析，每个来源都以 `apps/cli/src/bin.ts` 校验，仓库被移动后只会响亮失败而不会从失效路径启动。`scripts/dist.ts`（electron-builder，`electron-builder.yml`）把同一契约构建进 DMG 分发镜像——品牌图标、拖入 Applications 布局、asar 归档——代码签名由环境驱动：无 Developer ID 证书产出未签名包，`CSC_NAME` 加 Apple 公证变量产出签名公证的发布版。

## Verification

`tests/launcher.spec.ts`（无密钥单测）固化启动向量、URL 行解析（含纯展示性的 LAN 后缀）、三个来源的仓库根解析与两类失败形态、以及桩子进程上的停止升级决策。`tests/web-launch.e2e.ts`（无密钥组装测试）以完全相同的向量启动真实组合，断言页面携带 `__DSH_BOOT__` 且以退出码 0 停止。手工矩阵：检出内运行（`pnpm run desktop`）、宿主死亡路径、对主进程的 SIGTERM、打包产物的 `open`、以及 AppleScript `quit`——全部以零残留进程退出。分发镜像以同样方式验证：`hdiutil` 挂载构建出的 DMG、从挂载卷 `open` 应用（宿主子进程拉起）、`quit`（零残留）、弹出。

## Alternatives considered

| 备选 | 为何否决 |
|---|---|
| 主进程内嵌 boot（在 Electron 主进程跑 `runProfile`） | Electron 的固定 Node 与 engines 区间必须永远同步；组合崩溃会连带窗口；CLI 启动器的进程关闭契约需在壳内重新实现。 |
| `file://` dist + IPC 桥承载 fetch/WebSockets（webserver README 点名的最终形态） | 需要在 `client/connection` 新增 Electron 载体对与 boot-manifest 注入路径——比子进程壳大一个量级的能力 seam 变更，而尚无用户要求渲染器离开 HTTP 传输。它仍是壳想停止绑定端口时的文档化后续。 |
| Tauri | 宿主树反正需要 Node sidecar（Cordis 组合是 Node 的），壳将背负双运行时加 Rust 工具链才能达成同一子进程契约。 |
| 构建 CLI 启动向量（普通 node 跑 `apps/cli/lib/bin.js`） | 会把每次桌面运行耦合到先行的全量构建；源码向量让桌面壳保持零构建路径并与根 `dsh` 脚本完全一致。 |

## Consequences

桌面表面免费继承 Web 组合的每次变更，只新增一条维护事实：启动向量必须持续匹配根 `dsh` 脚本加 `--expose-internals`（单测已固化）。分发以 DMG 镜像（`desktop:dist`）交付并配环境驱动签名；Windows/Linux 安装器（nsis/AppImage）、自动更新接线与公证凭据仍由发布工程在需要时补齐。`file://` + IPC 载体仍是未来壳放弃 loopback 服务器时的文档化终点。
