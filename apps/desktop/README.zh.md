# `@deepseek-ai/dsh-desktop`

[English](README.md) | 中文

dsh Web GUI 的桌面壳：一个 Electron 主进程，把真实的 `dsh web` 组合作为子进程启动，并将其就绪的 loopback URL 加载进 BrowserWindow。渲染器就是普通的 Web GUI 走普通的传输——`webPreferences` 全部保持默认（沙箱、上下文隔离、无 node 集成、无 preload）；桌面壳不添加任何原生界面。

## 从检出运行

```sh
pnpm run desktop        # build the main process, then electron .
```

桌面壳以根 `dsh` 脚本的源码启动向量（`node --import tsx/esm apps/cli/src/bin.ts web --no-open --port 0`）启动子进程，并以 Electron 二进制充当其 Node 运行时（`ELECTRON_RUN_AS_NODE=1`），子进程的 Node 版本随之锁定在固定的 Electron 上而非系统 Node。`--expose-internals` 是向量的一部分：vendored Loader 的原生 addon 在 Electron 二进制下无法挂载，失去内部 loader 后裸插件名将无法解析。

## 打包应用程序

```sh
pnpm run desktop:pack   # build, then apps/desktop/scripts/pack.ts
```

产出 `apps/desktop/dist/DSH Desktop-darwin-arm64/DSH Desktop.app`（Windows/Linux 为平台目录树）。应用包只携带主进程构建——桌面壳没有运行时依赖——外加一份记录所托管检出的资源。双击 `.app` 即可，也可以拷入 `/Applications`。

## 构建分发镜像

```sh
pnpm run desktop:dist   # build, then apps/desktop/scripts/dist.ts (macOS)
```

经 electron-builder（`electron-builder.yml`）产出安装镜像 `apps/desktop/dist/dsh-desktop-<version>-<arch>.dmg`：品牌图标、标准的拖入 Applications 布局、同一份所托管检出标记，应用代码封入 asar 归档。挂载镜像、把应用拖入 `Applications`、启动——运行/退出生命周期即桌面壳自身。

代码签名由环境驱动：无 Developer ID 证书时构建器警告并跳过签名（下载镜像中的首次启动用 Finder 右键打开，或清除隔离属性）；发布者导出 `CSC_NAME` 签名，并配合 `APPLE_ID` / `APPLE_APP_SPECIFIC_PASSWORD` / `APPLE_TEAM_ID`（在 mac 目标上置 `notarize: true`）完成公证。

所托管的检出在启动时按序解析：`DSH_REPO_ROOT` 环境变量（绝对路径）、打包时记录的标记，或——检出内运行时——模块自身位置。每个被接受的路径都以 `apps/cli/src/bin.ts` 校验，仓库被移动后不会从失效路径静默启动，而是报错。移动仓库后重新打包，或把 `DSH_REPO_ROOT` 指向新位置。

## 生命周期

一个桌面壳生命周期只启动一个宿主子进程。关闭窗口或退出应用时以 SIGTERM 停止子进程（随附启动器会排空 fiber 树并以 0 退出），十秒后升级 SIGKILL；宿主自行死亡时以携带其 stderr 尾部的对话框使桌面壳失败退出。第二个实例会聚焦已有窗口。

无密钥测试覆盖：`tests/launcher.spec.ts` 以桩子进程固化启动向量、URL 行解析、仓库根解析与停止升级决策；`tests/web-launch.e2e.ts` 以完全相同的向量启动真实组合，断言页面可服务且停止为安静退出。
