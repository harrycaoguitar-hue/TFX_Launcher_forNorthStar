# 来源与第三方组件

TFX Launcher 是基于 ViperCN 1.11.3 的衍生项目。原启动器由 R2NorthstarCN / 0neGal 等贡献者维护，源项目：https://gitee.com/R2NorthstarCN/viper-cn 。沿用代码继续遵守 GPL-3.0-or-later；许可全文见 LICENSE。新增实现不能取消沿用部分的许可、署名和提供源码义务。

TFX 独立重新实现模组目录索引、开关与删除控制、模组管理界面、社区目录浏览、网络资源读取、Thunderstore 依赖计划与事务下载安装。Thunderstore 仍是数据和模组包提供方，来源：https://thunderstore.io/c/northstar/ ，公开目录接口：https://thunderstore.io/c/northstar/api/v1/package/ 。兼容旧配置和界面调用名称属于接口契约；旧模组管理、下载和前端依赖队列实现已替换。该工作以现有项目接口与行为为参照，不构成隔离净室重写，也不能因此宣称整个启动器脱离 GPL 来源。每个下载模组的作者、包内 LICENSE 和其他文件随模组原样保留；模组版权属于对应作者。

DDS 导入、格式与尺寸校验、声明式资源匹配、安装计划、局部备份、写入校验和恢复使用本项目的 JavaScript 实现。产品不包含或执行 Titanfall2-SkinTool、FoldDdsPlan 或其 .NET 依赖。src/modules/data/dds-layout-tf2.json 是对用户提供工具进行元数据兼容性查询测得的游戏资源位置事实，数据内保留来源与参考文件哈希。它不是独立发现所有游戏布局的通用 RPAK 解析器，也不包含参考工具的程序实现。开发所用参考工具不随运行包或源码包分发。用户提供的皮肤包及其图片不随产品分发；皮肤版权属于各自作者。

Steam KeyValues 解析器为新增实现，原 simple-vdf 依赖已移除。其余生产依赖 follow-redirects、fs-extra、fuse.js、jsonrepair 及传递依赖的许可随 node_modules 保留。Electron、Chromium、Node.js 与运行时使用的其他组件许可随目录版/便携包保留。

Roboto 2.137（2017）字体：Copyright 2011 Google Inc. All Rights Reserved.，采用 Apache License 2.0。字体原字节保持不变，完整许可、NOTICE 与官方来源记录见 src/app/fonts。部分旧 npm 包原发布包仅包含 MIT 声明；补附许可的确切来源和依据保存在各包的 NOTICE / LICENSE-SOURCE 中，未将补附文本冒称为原发布包内的许可文件。

VTF 安装模块 vtf-engine.js、vtf-vpk.js 为新增 JavaScript 实现。开发时参考 MIT 许可 tf2vpk 的 Titanfall 2 VPK 2.3 格式实现与 Northstar 公开源码。相关格式参考、来源与 MIT 许可保存在 src/tools/vtf/SOURCE.txt 和 tf2vpk-LICENSE.txt。用户提供的 VPK GUI 工具不包含在产品中。

压缩包读取使用未修改的 7-Zip 26.04 7z.exe/7z.dll 与 21.07 7za.exe 兼容回退。7-Zip Copyright Igor Pavlov；本体主要采用 GNU LGPL 2.1，部分代码采用 BSD，RAR 解压代码有 unRAR 限制；7zip-bin 包装包为 MIT。完整许可、LGPL 全文、对应版本源码下载地址保留于 src/tools/vtf。官方来源：https://github.com/ip7z/7zip 。

TITANFALL 2 题标来自 Steam Titanfall®2（app 1237970）官方店铺公开素材 https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/1237970/logo.png 。仅裁去透明边缘；游戏、题标和其他原有游戏素材权利属于 Respawn Entertainment / Electronic Arts 及各自权利人。游戏识别用途不表示官方认可。原有素材署名继续保留。

国服与全球服客户端随 1.0.0 提供离线安装数据：NorthstarCN 1.17.7（R2NorthstarCN/R2NorthstarCN_Launcher）与 Northstar 1.31.13（R2Northstar/Northstar）。启动器的文件清单、缓存及带回滚的切换实现为新增 JavaScript 模块；两套客户端本身是官方第三方软件，不能称为本项目原创。对应来源、版本、下载与逐文件哈希见 src/tools/clients/SOURCE.md、各频道 manifest.json；原有 LEGAL.txt、MIT、Apache 2.0 与其他组件许可见客户端数据和 licenses 目录。当前游戏的国服 1.18.0 只在用户本机保存私有快照，不随产品分发。

全球客户端中的 rAnim 与 serialized_io 公开源仓库声明 Apache-2.0；截至 2026-10-14，DiscordRPC 官方插件源仓库没有独立 LICENSE 或 Cargo license 声明，GitHub 许可元数据为 null。TFX 1.0.0 离线客户端数据因此省略该可选 DLL，只保留其来源、路径、原字节 SHA-256 和省略原因，不将客户端总体 MIT 声明冒称为该插件的独立再分发许可。省略影响 Discord Rich Presence，核心客户端、私人服务器菜单与联机模块均保留。用户自行通过启动器从官方发布下载完整客户端更新时，官方文件原样安装，该运行时下载不在 TFX 发行包内再分发。未来若要重新捆绑该插件，需明确适用的上游许可或授权。详见 src/tools/clients/SOURCE.md 与全球服 manifest.json 的 source.optionalOmissions。

1.0.0 的 DDS ZIP 读取复用本项目有界 ZIP 校验器，已移除 unzip-stream 及其未再使用的传递依赖。生产依赖版本与开发工具固定在 package.json / package-lock.json，现有组件的署名与许可继续保留。
