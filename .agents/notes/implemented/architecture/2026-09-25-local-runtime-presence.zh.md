# Agent Note: 本地运行时存在性探测与模型页运行时/API 分组

Status: implemented

[English](2026-09-25-local-runtime-presence.md) | 中文

## 问题

两个设置页面都曾无视本机是否真的能跑，把本地 CLI 运行时列出来：运行时页在没有装 CLI 的主机上照样渲染 Claude CLI / Codex CLI 行；模型页则为一个不存在的运行时提供编辑卡片（command、超时、模型目录）——而当它存在时，又把 `settings.yaml` 已经拥有的内容复制成第二个更弱的事实源。本地运行时是关于机器的事实，不是 profile：存在性属于 host 的文件系统，它加载的目录是运行时自己报告的东西。两个表面此前都没有存在性事实，因此「未安装」与「已安装但休眠」是无法区分的行。

## 决策

让可配置提供方目录声明本地性，让 host 回答存在性。`LlmConfigurableProvider` 新增可选字段 `localCommand`——本地 CLI 运行时 shell 调用到的可执行文件，跟随适配器当前配置，因此重定向 command 的 settings 编辑会让答案随之移动。llm-claude-cli 的 bundle 为两个驱动声明了它。`llm.providers` 在每次作答时探测每个已声明的 command（裸命令名走 `which`/`where`，带路径分隔符的命令直接查执行位），并把结果作为 `present` 随行返回；按回答探测意味着安装或移除 CLI 无需重启，下一次页面加载即可见，且缺失的 CLI 只降级该行，绝不拖垮整个列表。

两个表面随后按这一事实分野，而激活跟随探测。llm-claude-cli 的 codex 驱动在其段存在或本机解析到 codex CLI 时激活——仅凭探测即以驱动默认值激活，可用的本地运行时再不需要等待任何 `settings.yaml` 条目；显式段只覆盖探测到的运行时默认值。运行时页只列出活跃路由：host 找不到的运行时没有行（缺席的 CLI 永远不可能从这里服务请求），休眠路由同样没有行——它是以「模型」页为家的配置候选，因此「请配置该运行时」的指引行整体消失。模型页重新划分为「运行时」与「模型 API」两组：探测到存在且活跃的本地运行时只读渲染，从同一份 `llm.models` 答案列出它加载的模型；API 提供方保留全部既有可配置行为，包括负责收纳 API 候选的休眠目录添加流。CLI 家族编辑卡片整体退役——它对 command/timeout/目录的写入，与驱动自身配置段按请求解析的语义相比，只是第二个更弱的事实源。

## 后果

- Wire：`ConfigurableProviderView` 新增可选 `localCommand`/`present`；zod schema 与 `@deepseek-ai/dsh-api-remotes/client` 的再导出跟随 host 侧单一声明。新适配器用一个字段声明本地性，即可免费获得两个表面的行为。
- Host：`command-presence.ts` 以可注入的 platform/spawn/access 接缝探测（`native-path-opener` 模式）；`api-proxy.ts` 内联回答存在性。输入框选择器与 `session.models` 不受存在性影响——但探测确实触达 codex 驱动的路由：其激活条件恰为「段存在或探测到 CLI」。这是唯一选择「探测即激活」的适配器；任何适配器都可以在自己的 `apply` 中探测跟进。
- 模型页：store 把 `llm.models` 汇入 `rows` 旁的 `runtimes` 投影，仅活跃本地路由；`ProviderEditor` 删除 `claude-cli` 布局（回到两个策展家族），`ModelListEditor` 删除只有它使用的 `loadCandidates` 覆盖。
- 运行时页：休眠行与「请在 settings.yaml 中配置」提示已消失；每一行都是活跃路由及其目录或列举失败。引导就绪判定不受影响：活跃的本地路由仍计为可用提供方，与分组之前完全一致。

## 已考虑的替代方案

- **适配器侧探测并烘焙进目录条目**——否决：答案会在 settings 变更之间变陈（装了 CLI 却没有任何东西触发重新探测），而按回答的 host 探测代价很低（每条本地路由一次 `which` spawn），且永远不对机器此刻的真实状态撒谎。
- **保留 CLI 编辑器但按存在性门控**——否决：存在运行时的卡片仍然以更弱的写入路径复制驱动段按请求解析的语义；设置表面只报告与指引，本地运行时的覆盖项归 `settings.yaml` 所有。
- **在运行时页保留休眠行作为配置指引**——否决：本页的契约是「当前部署可调用的运行时」；休眠路由是「模型」页添加流的候选，settings.yaml 指引只会复制一个已有归属的入口。
- **codex 激活仍要求显式 settings 段，探测仅驱动展示**——否决：这会让已探测到的运行时形同虚设，用户还要为机器已经回答过的事实手写 YAML；探测即以默认值激活，配置段保持为覆盖通道。
- **把探测即激活扩展到 claude 驱动**——暂不采纳：挂载该包本身就是对其主驱动的显式配置（顶层简写），claude 注册已遵循声明的意图；codex 是可选的第二驱动，机器探测才是它的正确默认。
