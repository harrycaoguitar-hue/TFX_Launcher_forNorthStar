# TFX Launcher

**TITANFALL 2 · Northstar · NorthstarCN**

TFX 是面向 Windows x64 的《泰坦陨落 2》社区启动器，将原版游戏启动、Northstar 双客户端管理、社区服务器浏览、模组管理和 DDS / VTF 皮肤安装放在同一个界面中。

TFX is a Windows x64 community launcher for TITANFALL 2. It brings vanilla launch, Northstar client management, community server browsing, mod management, and DDS / VTF skin installation into one application.

**[下载 / Download](https://github.com/harrycaoguitar-hue/TFX_Launcher_forNorthStar/releases/latest) · [反馈 / Issues](https://github.com/harrycaoguitar-hue/TFX_Launcher_forNorthStar/issues) · [构建 / Build](BUILD.md) · [许可 / License](LICENSE)**

**[简体中文](#zh) | [English](#en)**

<a id="zh"></a>

## 简体中文

### 目录

- [安装与首次使用](#zh-start)
- [开始游戏与客户端管理](#zh-launch)
- [社区服务器](#zh-servers)
- [我的模组与 Thunderstore 下载](#zh-mods)
- [DDS 与 VTF 皮肤安装](#zh-skins)
- [备份、恢复与皮肤启动保护](#zh-recovery)
- [外观、语言与偏好设置](#zh-settings)
- [更新、存储与常见问题](#zh-help)
- [从源码运行、反馈与鸣谢](#zh-project)

<a id="zh-start"></a>

### 安装与首次使用

#### 使用条件

- Windows 64 位系统。本版本提供 Windows x64 发行包。
- 已购买并安装的 TITANFALL 2，以及正常可用的 Steam / EA 启动环境。TFX 不包含游戏本体。
- 游戏目录和数据存储盘有足够空间，用于客户端安装、下载缓存和皮肤恢复备份。
- 浏览服务器、访问 Thunderstore 和检查更新需要网络。1.0.0 附带两套 Northstar 客户端的首次安装数据；安装客户端不代表可以离线联机。

#### 开始使用

1. 在 [Releases](https://github.com/harrycaoguitar-hue/TFX_Launcher_forNorthStar/releases/latest) 下载 `TFX-Launcher-1.0.0.exe` 并运行。
2. TFX 会检查已保存的目录、Steam 游戏库和 EA 安装信息。自动识别失败时，点击 **选择目录 / 更改目录**，选择包含 `Titanfall2.exe` 的游戏根目录；不要选择 `steamapps`、`common` 或模组子目录。
3. 首次打开时，中文系统使用对应的简体或繁体中文，其他系统默认英语。可在 **偏好设置 → 外观与语言** 中更改，保存后会记住你的选择。
4. 在 **开始游戏** 选择原版或北极星。北极星还需要选择 **国服 / 全球服**；如果对应客户端显示未安装，先安装，再启动游戏。

便携版无需安装 TFX 自身，但仍会保存偏好、缓存和恢复记录。如果使用目录版，运行 `TFX-Launcher.exe` 并保留同目录下的全部文件。再次打开 TFX 会聚焦已有窗口，避免多个实例同时写入同一配置。

<a id="zh-launch"></a>

### 开始游戏与客户端管理

#### 原版游戏

**原版** 模式启动 EA 原版 TITANFALL 2，用于单人战役和官方多人游戏。首次交接时，Steam / EA 可能要求登录或确认启动；这些平台提示需要在对应平台完成。原版模式与 Northstar 社区服模式是两个独立入口。

首页显示游戏目录，并提供打开文件夹和更改目录的按钮。游戏运行时可通过结束游戏功能处理无响应进程；强制结束可能丢失未保存的进度。

#### NorthstarCN 与 Northstar

**北极星** 模式提供两个客户端渠道：

| 选择 | 客户端 | 1.0.0 内置首次安装版本 |
|---|---|---|
| 国服 | NorthstarCN | 1.17.7 |
| 全球服 | Northstar | 1.31.13 |

TFX 分别检查两个客户端的实际文件和安装状态，显示未安装、待切换、已启用或需要修复等状态。内置安装包或下载缓存的存在不会被当成已安装。

- **首次安装：** 点击所选渠道的安装按钮，等待展开和校验完成，再点击启动。安装和启动是两个步骤。
- **渠道切换：** 两套客户端准备好后，选择另一渠道并启动，TFX 会切换对应的核心文件。切换保留个人模组、皮肤和设置；再次启动同一渠道时会复用准备好的文件，减少重复解压和复制。
- **版本识别：** 首页显示当前所选客户端的实际版本。已经识别到的较新本地客户端会被保留，不会直接用内置旧版本降级。
- **客户端更新：** 首页的检查更新针对 Northstar 客户端。偏好设置提供自动更新、刷新版本信息、重新安装，以及更新时保留文件的选项。未安装的渠道仍需要先明确执行首次安装。
- **运行中保护：** 游戏运行时不能切换或改写客户端。安装期间变更目标目录或渠道会中止提交，并处理恢复，避免把文件写入错误目标。
- **启动反馈：** TFX 检查游戏进程和 Northstar 核心菜单加载状态，提供失败原因。启动途中快速关闭游戏会解除等待状态，以便再次尝试。

需要更低的后台占用时，可开启 **游戏启动后退出 TFX**。TFX 确认本次启动成功后自动退出；启动失败时保留窗口。该选项默认关闭。

<a id="zh-servers"></a>

### 社区服务器

左侧的 **社区服务器** 页面按纵向列表显示国服或全球服的公开服务器。可以搜索服务器名称、地图和玩法，查看当前人数 / 人数上限、服务器说明以及所需模组等信息。列表按在线人数优先排列，共用页面滚动区域。

数据来自各网络的公开服务器目录。页面提供手动刷新；相关页面可见时约每分钟刷新一次，离开页面、被弹窗遮挡或窗口隐藏时暂停无用轮询。网络失败时会区分不可用和上次缓存，不把旧数据当成刚刚获取的结果。

北极星首页左下角保留所选网络公开服务器的在线人数。这里是公开目录中的人数汇总，不是所有玩家的在线总量。时间与更新时间按本机系统时间显示，服务器人数会随刷新变化。

服务器列表用于浏览。启动相应客户端后，在游戏内的服务器浏览器中加入服务器；TFX 1.0.0 不提供从列表直接加入游戏的功能。

<a id="zh-mods"></a>

### 我的模组与 Thunderstore 下载

#### 管理已安装模组

**我的模组** 采用卡片布局，显示模组名称、作者、说明和当前状态，并提供启用、停用和移除操作。搜索支持名称、作者和说明。

排序菜单使用 TFX 自身界面，提供：

| 排序 | 行为 |
|---|---|
| 添加时间 | 较新添加的模组在前 |
| 名称首字母 | 按名称排列，并采用当前语言的排序规则 |
| 启用状态 | 已启用的模组在前，同状态按名称排列 |

修改开关时会显示保存中的状态和结果；保存失败时恢复实际状态。列表更新保留搜索内容和滚动位置，减少操作后跳回顶部的情况。页面也提供批量切换和移除入口，必需的核心组件受保护。

#### 发现与下载模组

点击 **我的模组 → 发现模组**，浏览 [Thunderstore 的 Northstar 社区目录](https://thunderstore.io/c/northstar/)。可以搜索名称和作者，并使用类别筛选。

TFX 会规划依赖、下载并校验安装内容，全部准备成功后再提交。下载可取消；失败时保留或恢复既有内容，避免留下只安装了一部分的依赖。含原生插件的安装会先要求在应用内确认。模组作者资料和包内许可证保持原样。

Thunderstore 是目录与安装包的提供方。TFX 的目录浏览、依赖计划、下载安装和管理实现由本项目重新编写；模组本身由各自作者提供。

#### 从外部导入

可通过导入按钮或拖入文件，安装包含有效 `mod.json` 的 **ZIP 压缩包** 或 **完整模组文件夹**。导入会检查定义文件、目录结构和文件路径。损坏包、不安全路径、伪装的核心组件，以及误放到此页面的 DDS / VTF 皮肤会明确报错。

本地模组导入的支持格式与 VTF 皮肤导入不同：RAR / 7z 模组请先解压成完整模组文件夹。皮肤应在对应的 DDS / VTF 页面安装。

<a id="zh-skins"></a>

### DDS 与 VTF 皮肤安装

两种格式都有独立页面，采用 **导入 → 检查计划 → 安装** 的流程。安装前关闭游戏，检查页面上的目标目录和文件清单，再执行安装。可查看进度、操作日志以及安装记录。

| 页面 | 支持的输入 | 需要保留的结构 |
|---|---|---|
| DDS 安装 | 单个 `.dds` 文件、包含 DDS 的 ZIP、皮肤文件夹 | 原始 DDS 文件名，用于匹配游戏资源 |
| VTF 安装 | 完整皮肤文件夹，或含兼容文件的 ZIP、7z、RAR 等可读取压缩包 | 原始 `materials / models` 目录结构 |

#### DDS 安装

导入后，TFX 检查 DDS 文件头、压缩格式、尺寸、可识别的资源位置和分辨率覆盖，再显示文件数、目标资源和检查结果。格式不对或资源不匹配时不会进入可安装状态。

同一枪械替换新皮肤时，TFX 会处理旧皮肤覆盖的资源范围。新皮肤未提供的部分需要可靠的原版数据才能恢复，避免旧皮肤的文字、瞄具等残留。若游戏已经被其他工具改写且没有可信原版备份，页面会要求选择原版资源备份，或打开 Steam 验证游戏后重新检查。

这套检查基于已识别的游戏资源布局；不表示任意 DDS 文件、任意游戏版本或任意皮肤包都能直接安装。TFX 会给出当前包的检查结果。

#### VTF 安装

TFX 根据压缩包里的兼容皮肤文件判断是否可安装，而不只看 ZIP、7z 或 RAR 扩展名。支持动态 VTF 和关联模型，安装前检查文件内容与目录结构，并生成独立皮肤数据及恢复记录。

损坏压缩包、没有兼容文件或结构不完整的皮肤会报错。保留作者提供的 `materials / models` 结构，不要把所有文件改名或平铺到同一个目录。

#### 两种格式之间替换

同一枪械的 DDS → VTF 和 VTF → DDS 替换由共同安装流程处理旧资源与模型入口，并保存恢复记录。遇到无法确认的原版资源或未完成安装时，TFX 会要求先恢复或修复。

误导入另一种格式后，当前待安装选择会被清空并提示错误，不会继续安装上一次选择的包。使用其他工具在 TFX 之外改写游戏资源时，也可能需要先恢复可信原版状态再继续安装。

<a id="zh-recovery"></a>

### 备份、恢复与皮肤启动保护

#### 安装备份

DDS 和 VTF 安装前都会备份所需资源，并在写入后验证。各页面默认显示最近 **5 条**记录，其余记录可以展开查看。

- **恢复：** 按记录恢复对应安装。若有多次覆盖，先恢复较新的记录；跨格式安装会同时处理相关 DDS / VTF 资源。
- **删除：** 每条记录都有删除入口，适用于已经结束且不再被恢复流程依赖的历史记录。当前皮肤、未完成安装和跨格式恢复需要的备份不能直接删除。
- **定位：** 可打开备份目录并查看操作日志。不要绕过应用手动删除当前恢复流程需要的文件。

安装过程中如果游戏启动、目标文件被外部修改或校验失败，TFX 会停止提交并保留可恢复记录。发现未完成安装时，应按页面提示先处理恢复；关闭启动保护不会绕过这项检查。

#### 皮肤启动保护

在 **偏好设置 → 皮肤启动保护** 中，统一控制 DDS 与 VTF 的启动前设置恢复。

首次安装皮肤时，TFX 记录当前的皮肤兼容性设置；保护开启后，在从 TFX 启动游戏前恢复这些记录值。设置里可以查看记录、刷新状态，并在退出游戏后重新记录当前设置。

记录的是你的当前选择，并不是适用于所有皮肤的固定兼容预设。建议先在游戏中确认显示正常，再重新记录。保护涉及 `setting.stream_memory` 和 `setting.mat_picmip`，不会锁定游戏内画面选项，也不需要额外安装 UI 模组。

**保护开关立即保存。** 关闭设置或点击取消不会撤销这次开关操作；普通主题、语言等未保存预览仍可取消。

<a id="zh-settings"></a>

### 外观、语言与偏好设置

#### 磨砂界面与主题

TFX 使用半透明磨砂面板、圆角卡片和短时页面过渡。导航、偏好设置和操作反馈均有过渡效果；系统启用减少动态效果时遵从该设置。窗口使用方形外边框，顶部空白区域可拖动，双击可最大化或还原。

十种配色可在偏好设置中预览：**极光青、深海蓝、星云紫、绯樱粉、熔金橙、青柠绿、砂岩棕、岩墨灰、冰川蓝、云雾白**。最后两种为浅色主题。点击保存后保留选择；取消恢复未保存前的外观。

#### 五种界面语言

支持 **简体中文、繁體中文、English、Deutsch、Français**。首次默认语言依据系统语言，不根据 IP 或所在地；非中文系统首次默认英语，包括德语和法语系统。手动选择并保存后优先使用该选择。语言菜单与模组排序菜单均使用应用自身样式。

#### 设置项目

设置顶部可搜索语言、主题和启动等选项，相关项目按用途组织：

| 分类 | 可用功能 |
|---|---|
| 外观与语言 | 切换界面语言、预览和保存十种主题 |
| 游戏启动 | 打开 / 更改游戏目录、编辑 Northstar 启动参数、启动后退出 TFX、退出 TFX 时关闭 Origin |
| 皮肤启动保护 | 开关启动前恢复、查看记录、刷新状态、重新记录当前设置 |
| 北极星更新 | 自动检查与更新、设置更新时保留的文件、刷新版本信息、重新安装所选客户端 |
| 连接与网络 | 清理 DNS 缓存、选择 DNS 服务或自动获取并明确应用 |
| 维护工具 | 清理安装缓存、结束游戏 / Origin 进程、重启 TFX |
| 关于 | 作者、联系邮箱、GitHub Issue、特别鸣谢、版本与 TFX 检查更新 |

DNS 工具只在主动操作并确认后修改系统网络设置，更换 DNS 可能要求 Windows 管理员权限。清理安装缓存后，下次需要的安装包会重新获取。结束进程和重装等维护操作应按界面提示使用。

普通偏好在点击 **保存更改** 且成功写入后保存。写入失败时设置保持打开，保留输入。**取消** 撤销未保存的预览。

#### 长按恢复默认

**恢复默认偏好** 需要连续按住 **2 秒**，提前松开、移开、失焦或关闭设置会取消。完成后立即保存默认界面、语言和启动偏好，保留游戏目录、缓存路径、已经安装的模组和皮肤。这不是卸载、删除游戏或恢复原版皮肤的按钮。

<a id="zh-help"></a>

### 更新、存储与常见问题

#### 两类更新

- **Northstar 客户端更新：** 更新游戏目录中对应渠道的客户端，通过首页和北极星更新设置管理。
- **TFX 应用更新：** 在 **偏好设置 → 关于 → 应用更新** 读取[本仓库的最新正式 Release](https://github.com/harrycaoguitar-hue/TFX_Launcher_forNorthStar/releases/latest)。检查结果区分已是最新、存在新版、尚未发布和网络失败。选择下载后打开官方 GitHub 链接，不在后台静默替换运行中的程序。

Release 提供应用、对应源码、英文验收与署名说明，以及 SHA-256 校验清单。使用发布页的 EXE；GitHub 自动生成的源码下载是开发者用源码，不是可运行的 Windows 应用。

#### 存储与清理

偏好保存在 Windows 应用数据目录。Northstar 下载缓存与客户端事务数据、Thunderstore 缓存，以及部分模组状态备份在存在 D 盘时优先使用 `D:/TFX-Launcher-Data`。DDS / VTF 皮肤备份和跨格式恢复记录保存在 Windows 应用数据目录的 `fold-launcher` 下；用于快速切换的客户端副本存放在游戏目录内的 `.tfx` 区域。各皮肤页的 **打开备份目录** 可定位实际位置。

恢复数据属于实际恢复流程的一部分，不能把整个应用数据目录或游戏内的 `.tfx` 目录当作普通缓存删除。

释放空间时优先使用 **维护工具 → 清理安装缓存**，以及各皮肤页允许删除的历史备份。长按恢复默认会保留这些资源。

#### 常见问题

| 情况 | 处理方式 |
|---|---|
| 找不到游戏 | 手动选择包含 `Titanfall2.exe` 的根目录，确认 Steam / EA 安装完整 |
| 北极星显示未安装 | 先安装当前选择的渠道；有另一个渠道并不代表两者都已安装 |
| 点启动后需要平台确认 | 在 Steam / EA 完成登录或启动确认，再返回查看结果 |
| 游戏有运行进程却未确认 Northstar 菜单 | 关闭游戏，查看启动错误提示，检查所选客户端状态，必要时刷新或重装 |
| 服务器列表 / 模组目录加载失败 | 检查网络，稍后手动刷新；缓存人数和更新时间不是当前实时状态 |
| DDS / VTF 报错或安装按钮不可用 | 按格式表选择对应页面，保留文件名 / 目录结构，并查看检查结果与日志 |
| 旧皮肤部分残留或提示缺少原版数据 | 先恢复已有记录，或提供可靠的原版资源备份；使用 Steam 验证后重新检查 |
| 提示未完成安装或备份被依赖 | 按提示先恢复较新的记录，保留相关备份；不要直接删除恢复文件 |
| 想减少游戏时的启动器占用 | 开启游戏启动后退出 TFX，保存后在下一次成功启动生效 |

Steam 验证会修复原版游戏文件，可能覆盖已改写的皮肤资源。按 TFX 页面提示安排验证与恢复，完成后重新检查安装计划。第三方模组、皮肤与在线服务由各自作者维护，兼容性仍取决于包内容、客户端版本和服务状态。

<a id="zh-project"></a>

### 从源码运行、反馈与鸣谢

#### 开发与构建

需要 Windows x64、Node.js **22.12 或更高版本**和 npm。在仓库根目录运行：

```powershell
npm ci
npm test
npm start
# 构建 Windows x64 便携版
npm run dist
```

完整构建要求、输出与许可处理见 [BUILD.md](BUILD.md)。`src/tools/` 中的工具、客户端数据及许可证是构建和离线首次安装所需内容，请完整保留。发布版本使用固定依赖版本；本仓库的 `npm test` 覆盖 324 项测试，具体实机验证范围与限制见 Release 中的英文验收与署名说明。

#### 联系作者

作者：**HarryCao**。

如遇使用问题或有改进建议，欢迎通过 [GitHub Issues](https://github.com/harrycaoguitar-hue/TFX_Launcher_forNorthStar/issues) 反馈，或发送邮件至 **harrycaoguitar@gmail.com**。建议提供 TFX 版本、所选客户端、操作步骤和报错文字；附日志前检查其中的个人路径等信息。

#### 特别鸣谢

| 鸣谢 |
|---|
| Northstar |
| NorthstarCN |
| Glock-雨夜 |
| HK560 |
| zxcPandora |

感谢以上团队与贡献者，以及所有参与测试和反馈的玩家。

#### 许可证与来源

TFX 是基于 ViperCN 1.11.3 的 **GPL-3.0-or-later** 衍生项目。模组管理、Thunderstore 浏览与安装、DDS / VTF 安装及双客户端管理等部分已采用本项目新增实现；这些工作不会取消沿用代码的许可、署名与提供对应源码义务，也不表示整个应用是净室重写。

完整项目许可见 [LICENSE](LICENSE)，来源与第三方组件说明见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。官方客户端、下载模组、Electron 运行时、字体和压缩工具保留各自许可证。1.0.0 内置全球服包省略了许可未明确的可选 Discord Rich Presence 插件；核心客户端与社区服务器菜单保留，后续通过官方发布下载的完整更新按官方内容安装。

TFX 是社区项目，与 Respawn Entertainment 或 Electronic Arts 无隶属关系，也不代表其官方认可。TITANFALL 2 名称、标识和游戏素材属于各自权利人。

---

<a id="en"></a>

## English

### Contents

- [Installation and first use](#en-start)
- [Launching and client management](#en-launch)
- [Community servers](#en-servers)
- [My Mods and Thunderstore downloads](#en-mods)
- [DDS and VTF skin installation](#en-skins)
- [Backups, restoration, and skin launch protection](#en-recovery)
- [Appearance, languages, and preferences](#en-settings)
- [Updates, storage, and troubleshooting](#en-help)
- [Building, support, and credits](#en-project)

<a id="en-start"></a>

### Installation and first use

#### Requirements

- A 64-bit Windows system. This release provides a Windows x64 build.
- A purchased, installed copy of TITANFALL 2 and a working Steam / EA launch environment. TFX does not include the game.
- Enough free space on the game and data drives for client installation, download caches, and skin recovery backups.
- Internet access for server browsing, Thunderstore, and update checks. Version 1.0.0 includes first-install data for both Northstar clients; installing a client does not make online play available offline.

#### Getting started

1. Download and run `TFX-Launcher-1.0.0.exe` from [Releases](https://github.com/harrycaoguitar-hue/TFX_Launcher_forNorthStar/releases/latest).
2. TFX checks your saved location, Steam libraries, and EA installation information. If detection fails, use **Choose folder / Change folder** to select the game root containing `Titanfall2.exe`. Do not select `steamapps`, `common`, or a mod subfolder.
3. On first use, Chinese system languages select Simplified or Traditional Chinese as appropriate; other system languages default to English. Change this in **Preferences → Appearance & language** and save to keep your choice.
4. In **Play**, choose vanilla or Northstar. For Northstar, also choose **CN / Global**. If the selected client is not installed, install it before launching.

The portable EXE does not require a separate TFX installation, but it still saves preferences, caches, and recovery records. If using a directory build, run `TFX-Launcher.exe` and keep all files beside it. Opening TFX again focuses the existing window so multiple instances do not write to the same configuration at once.

<a id="en-launch"></a>

### Launching and client management

#### Vanilla game

**Vanilla** launches the EA version of TITANFALL 2 for the campaign and official multiplayer. Steam / EA may require a sign-in or launch confirmation during the initial handoff; complete these prompts in the relevant platform. Vanilla and Northstar community play have separate launch modes.

The home page shows the game folder and lets you open or change it. The end-game control can stop an unresponsive game process; forcing it to close may lose unsaved progress.

#### NorthstarCN and Northstar

**Northstar** offers two client channels:

| Selection | Client | First-install version bundled with 1.0.0 |
|---|---|---|
| CN | NorthstarCN | 1.17.7 |
| Global | Northstar | 1.31.13 |

TFX checks each client's actual files and installation state separately, showing states such as not installed, ready to switch, active, or repair required. A bundled archive or downloaded cache is not treated as an installed client.

- **First installation:** Use the selected channel's install button, wait for extraction and verification, and then launch. Installation and launch are separate actions.
- **Channel switching:** Once both clients are prepared, select the other channel and launch. TFX switches the corresponding core files while retaining personal mods, skins, and settings. Repeated launches of the same channel reuse prepared files to reduce extraction and copying.
- **Version detection:** The home page shows the selected client's actual version. A recognized newer local client is preserved rather than directly downgraded to the older bundled version.
- **Client updates:** The home page's update check targets the Northstar client. Preferences provide automatic updates, version refresh, reinstallation, and files to retain during updates. An uninstalled channel still requires an explicit first installation.
- **Protection while running:** Client switching and file replacement are blocked while the game runs. Changing the target folder or channel during installation stops the commit and handles recovery to avoid writing to the wrong destination.
- **Launch feedback:** TFX checks the game process and Northstar core-menu loading, and reports failure reasons. Closing the game quickly during startup releases the waiting state so you can retry.

To reduce background use during play, enable **Exit TFX after the game starts**. TFX exits after confirming the launch succeeded and stays open if it fails. This option is off by default.

<a id="en-servers"></a>

### Community servers

The **Community Servers** page in the sidebar presents the CN or Global public directory as a vertical list. Search by server name, map, or mode, and inspect player counts / capacity, descriptions, and required mods. Servers with more players appear first, using the page's shared scrolling area.

Data comes from each network's public server directory. You can refresh manually; relevant visible pages refresh about once a minute. Unnecessary polling pauses when the page is left, covered by a popup, or the window is hidden. Failed requests distinguish unavailable data from the last cached list rather than presenting old data as a new result.

The lower-left corner of the Northstar home page shows the selected network's public-server player count. This is a sum from the public directory, not a count of every player online. Displayed times and refresh timestamps use your computer's system time; player counts change with directory refreshes.

This list is for browsing. Launch the matching client and join through its in-game server browser. TFX 1.0.0 does not join games directly from its server list.

<a id="en-mods"></a>

### My Mods and Thunderstore downloads

#### Installed mods

**My Mods** uses cards to show each mod's name, author, description, and state, with controls to enable, disable, or remove it. Search matches names, authors, and descriptions.

The sorting menu uses TFX's own interface and offers:

| Sort | Behavior |
|---|---|
| Added date | Recently added mods first |
| Name | Name order using the selected language's sorting rules |
| Enabled state | Enabled mods first, then name order within each state |

Toggles show saving status and the result; a failed save restores the actual state. List updates preserve the search and scroll position to reduce jumps to the top. Bulk toggle and removal controls are also available, with required core components protected.

#### Browse and download

Open **My Mods → Discover Mods** to browse [Thunderstore's Northstar community directory](https://thunderstore.io/c/northstar/). Search names and authors, and filter by category.

TFX plans dependencies, downloads and checks the installation content, and commits only after everything is ready. Downloads can be cancelled. Failures preserve or restore existing content rather than leaving only some dependencies installed. Native plugin installations require confirmation inside the app. Mod author information and package licenses are retained.

Thunderstore provides the catalog and packages. The catalog browser, dependency planning, download, installation, and management implementations were rewritten for this project; individual mods are provided by their authors.

#### Local imports

Use the import button or drag in files to install a **ZIP archive** or **complete mod folder** containing a valid `mod.json`. Imports check the definition, folder structure, and file paths. Damaged packages, unsafe paths, disguised core components, and DDS / VTF skins imported on this page produce explicit errors.

Local mod imports and VTF skin imports support different inputs: extract RAR / 7z mod archives into complete folders first. Install skins on the corresponding DDS / VTF page.

<a id="en-skins"></a>

### DDS and VTF skin installation

Each format has its own page with an **import → review the plan → install** workflow. Close the game before installing, then check the target folder and file list. Both pages provide progress, operation logs, and installation records.

| Page | Accepted inputs | Structure to retain |
|---|---|---|
| DDS installer | A `.dds` file, a ZIP containing DDS files, or a skin folder | Original DDS filenames used to match game resources |
| VTF installer | A complete skin folder, or a readable ZIP, 7z, RAR, or other supported archive with compatible assets | Original `materials / models` folder structure |

#### DDS installation

TFX checks DDS headers, compression formats, dimensions, recognized resource locations, and resolution coverage. The plan shows file counts, target resources, and validation results. Invalid formats or unmatched resources do not become ready to install.

Replacing a skin for the same weapon also handles resources covered by the previous skin. Parts omitted by the new package need reliable original data to restore them, preventing old lettering, sights, and similar details from remaining. If another tool has already changed the game and no trusted original backup is available, the page asks you to select original resource backups or open Steam verification and check again afterwards.

These checks use recognized game-resource layouts. They do not mean any DDS file, game version, or skin package can be installed directly; TFX reports the result for the selected package.

#### VTF installation

TFX checks compatible assets inside the archive rather than accepting a package solely because its extension is ZIP, 7z, or RAR. Animated VTF skins and associated models are supported. Content and folder checks precede generation of separate skin data and recovery records.

Damaged archives, packages without compatible files, and incomplete structures produce errors. Keep the author's `materials / models` structure instead of renaming everything or flattening it into one folder.

#### Switching skin formats

For the same weapon, DDS → VTF and VTF → DDS replacement share an installation workflow that handles previous resources and model entries and retains recovery records. Unconfirmed original data or unfinished installations require restoration or repair first.

Importing the wrong format clears the pending selection and reports the error; it does not install the previously selected package. If another tool changes game resources outside TFX, a trusted original state may need to be restored before installation can continue.

<a id="en-recovery"></a>

### Backups, restoration, and skin launch protection

#### Installation backups

DDS and VTF operations back up required resources before installation and verify writes afterwards. Each page initially shows the latest **5 records**; expand the history to view the rest.

- **Restore:** Restore the installation described by a record. When installations overlap, restore newer records first. Cross-format restoration handles the related DDS / VTF resources together.
- **Delete:** Each record has a delete control for completed historical backups that no longer support recovery. Backups required by the current skin, unfinished installation, or cross-format recovery cannot be deleted directly.
- **Locate:** Open the backup folder or read the operation log. Avoid manually removing files still needed by an active recovery workflow.

If the game starts, another program changes a target, or verification fails during installation, TFX stops committing and retains recovery information. Follow the page's recovery prompt for unfinished work; turning off launch protection does not bypass this check.

#### Skin launch protection

In **Preferences → Skin launch protection**, control pre-launch settings restoration for both DDS and VTF skins.

TFX records the current skin compatibility settings on the first skin installation. When protection is enabled, it restores those recorded values before a game launch from TFX. You can inspect the record, refresh its status, and record your current settings again after closing the game.

These are your recorded choices, not a fixed compatibility preset suitable for every skin. Confirm the skin displays correctly in-game before capturing a new record. Protection covers `setting.stream_memory` and `setting.mat_picmip`; it does not lock in-game graphics options and does not require an extra UI mod.

**The protection switch saves immediately.** Closing Preferences or choosing Cancel does not undo that switch. Unsaved previews of normal preferences such as theme and language can still be cancelled.

<a id="en-settings"></a>

### Appearance, languages, and preferences

#### Frosted interface and themes

TFX uses translucent frosted panels, rounded cards, and short page transitions. Navigation, Preferences, and action feedback have transitions, with reduced motion respected when enabled by the system. The outer window frame is rectangular. Drag its blank top area to move it, or double-click to maximize or restore it.

Preview ten palettes in Preferences: **Aurora, Abyss, Nebula, Sakura, Ember, Grove, Sandstone, Graphite, Glacier, and Mist**. The last two are light themes. Save to retain a selection; Cancel restores the appearance before the unsaved preview.

#### Five interface languages

Supported languages are **简体中文, 繁體中文, English, Deutsch, and Français**. The first-use language follows the system language rather than your IP or location. Non-Chinese systems default to English, including German and French systems. A manually saved choice takes priority. Language and mod-sorting menus use the app's own styling.

#### Preference controls

The search field at the top of Preferences finds language, theme, launch, and other options. Controls are grouped by purpose:

| Group | Available controls |
|---|---|
| Appearance & language | Interface language; preview and save ten themes |
| Game launch | Open / change game folder; Northstar arguments; exit TFX after launch; close Origin when TFX exits |
| Skin launch protection | Restore switch; view record; refresh status; capture current settings |
| Northstar updates | Automatic checks and updates; retained files; refresh version information; reinstall the selected client |
| Connection & network | Flush DNS cache; choose a DNS provider or automatic configuration and apply it explicitly |
| Maintenance | Clear installation cache; end game / Origin processes; restart TFX |
| About | Author; email; GitHub Issues; special thanks; version; TFX update check |

DNS tools change system network configuration only after an explicit action and confirmation. Applying a DNS change may require Windows administrator permission. Clearing installation caches means required packages will be fetched again later. Use process termination and reinstallation tools according to their prompts.

Normal preferences are saved only after **Save changes** writes successfully. If saving fails, Preferences remains open with your input retained. **Cancel** reverses unsaved previews.

#### Hold to restore defaults

**Restore default preferences** requires a continuous **2-second hold**. Releasing early, moving away, losing focus, or closing Preferences cancels it. Completion immediately saves default appearance, language, and launch preferences while keeping the game folder, cache paths, installed mods, and skins. It does not uninstall the app, delete the game, or restore original skins.

<a id="en-help"></a>

### Updates, storage, and troubleshooting

#### Two kinds of updates

- **Northstar client updates:** Update the selected channel's files in the game folder through the home page and Northstar update preferences.
- **TFX app updates:** **Preferences → About → App updates** reads [this repository's latest stable Release](https://github.com/harrycaoguitar-hue/TFX_Launcher_forNorthStar/releases/latest). Results distinguish up to date, update available, no published release, and network failure. Choosing a download opens the official GitHub link; TFX does not silently replace the running app.

Releases provide the application, matching source archive, English acceptance and attribution document, and SHA-256 checksums. Use the release EXE. GitHub's automatically generated source download is for development, not a runnable Windows application.

#### Storage and cleanup

Preferences are stored in the Windows application data directory. Northstar download caches and client transaction data, Thunderstore caches, and some mod-state backups prefer `D:/TFX-Launcher-Data` when drive D: exists. DDS / VTF skin backups and cross-format recovery records remain under `fold-launcher` in Windows application data; client copies for fast switching use the `.tfx` area inside the game folder. Use **Open backup folder** on each skin page to locate its actual storage.

Recovery files support actual restoration workflows. Do not treat the entire application data directory or the game's `.tfx` directory as disposable cache.

To reclaim space, use **Maintenance → Clear installation cache** and deletable historical backups on the skin pages. Restoring default preferences preserves these resources.

#### Common issues

| Situation | Suggested action |
|---|---|
| Game not found | Select the root containing `Titanfall2.exe` and check that Steam / EA installation is complete |
| Northstar says not installed | Install the selected channel first; having one client does not mean both are installed |
| Launch requires platform confirmation | Finish the sign-in or launch confirmation in Steam / EA, then return to the result |
| Game process exists but the Northstar menu is unconfirmed | Close the game, read the launch error, check the selected client's state, and refresh or reinstall if necessary |
| Server list / mod catalog fails to load | Check connectivity and refresh later; cached counts and timestamps are not a current live result |
| DDS / VTF import errors or disabled install button | Use the matching page, retain names / structure, and read validation results and logs |
| Old skin parts remain or original data is missing | Restore existing records or supply reliable original backups; check again after Steam verification |
| Unfinished installation or dependent backup reported | Restore newer records as prompted and retain related backups; do not delete recovery files directly |
| Want lower launcher usage during play | Enable exit after launch and save; it applies on the next successful launch |

Steam verification repairs original game files and may overwrite modified skin resources. Follow TFX's instructions when arranging verification and restoration, then check the installation plan again. Third-party mods, skins, and online services are maintained by their authors; compatibility still depends on package contents, client versions, and service availability.

<a id="en-project"></a>

### Building, support, and credits

#### Development and builds

Use Windows x64, Node.js **22.12 or newer**, and npm. From the repository root:

```powershell
npm ci
npm test
npm start
# Build the Windows x64 portable application
npm run dist
```

See [BUILD.md](BUILD.md) for full requirements, outputs, and license handling. Keep the tools, client data, and licenses in `src/tools/`; they are needed for builds and offline first installation. Dependencies are pinned for the release. This repository's `npm test` covers 324 tests; the English acceptance and attribution document attached to the Release describes the scope and limits of actual-machine validation.

#### Support

Author: **HarryCao**.

For problems or suggestions, open a [GitHub Issue](https://github.com/harrycaoguitar-hue/TFX_Launcher_forNorthStar/issues) or email **harrycaoguitar@gmail.com**. Include the TFX version, selected client, reproduction steps, and error text. Review logs for personal paths before sharing them.

#### Special thanks

| Acknowledgments |
|---|
| Northstar |
| NorthstarCN |
| Glock-雨夜 |
| HK560 |
| zxcPandora |

Thank you to these teams and contributors, and to everyone who tested TFX or provided feedback.

#### License and provenance

TFX is a **GPL-3.0-or-later** derivative of ViperCN 1.11.3. Mod management, Thunderstore browsing and installation, DDS / VTF installation, and dual-client management include new implementations written for this project. This work does not remove attribution, license, or corresponding-source obligations for inherited code, and does not make the entire application a clean-room rewrite.

See [LICENSE](LICENSE) for the project license and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for provenance and third-party notices. Official clients, downloaded mods, the Electron runtime, fonts, and archive tools retain their own licenses. The Global client bundled with 1.0.0 omits the optional Discord Rich Presence plugin because its redistribution license was not clearly declared. Core client files and the community-server menu remain included; full updates downloaded from official releases are installed with their official contents.

TFX is a community project and is not affiliated with or endorsed by Respawn Entertainment or Electronic Arts. The TITANFALL 2 name, logo, and game assets belong to their respective rights holders.
