# TFX Launcher 1.0.4-beta.2 validation and attribution

This prerelease uses the previously accepted Windows x64 portable executable unchanged.

- Executable: TFX-Launcher-1.0.4-beta.2.exe
- Bytes: 278540166
- SHA-256: 7b2c8b0304d4677145a101965c403f8ab6a910a679b1257fd469bcd21aad6cb9
- Accepted app.asar SHA-256: 04f3e2f3b92581b281e30940267e8a7fabe498854910887670d38b9c5d9fe597
- Accepted source inventory: 403 files, tree SHA-256 a4af9dfe32f5863007355c943e48d9e4f5562eac56215c4ff13dfb1b20555aaf
- Automated suite: 899 passed, 0 failed, 0 skipped in the accepted build. Publication verification reruns the suite and compares every runtime source file with the accepted app.asar.
- Build and isolated portable startup smoke passed. Publication changes README and release documentation only relative to that accepted source; runtime files, package metadata, licenses and bundled tools are preserved byte for byte.

The prior live acceptance records cover official clean and modded multiplayer, NorthstarCN menus, and CN/Global authentication and menu checks with a compatible local Mod selection. They do not establish match joining on all networks or correct effects of every third-party Mod. The final Steam command-line handoff was covered by automated fixtures; its live platform confirmation was not rechecked in the earlier acceptance.

Official Mod mode requires compatible client-side Mods. Native plugins and resource files are shared between modes; the three-server option separates enabled Mod states only. Individual Mod conflicts are environment dependent. The release does not include or change a user's personal Mod selection, game files, diagnostics or account data.

The application remains GPL-3.0-or-later. Preserve LICENSE and THIRD_PARTY_NOTICES.md. VanillaPlus 2.5.1 and the Northstar clients retain their upstream attribution and licenses; see THIRD_PARTY_NOTICES.md and src/tools/clients/SOURCE.md. TITANFALL 2 and platform services are not included.

## 中文

本次发布沿用已验收的 1.0.4-beta.2 便携版，未重建、未更改可执行文件。899 项自动化测试已通过；发布时再次执行测试并逐项核对运行时代码与已验收 app.asar。源码包与仓库中的运行时代码、版本信息、许可证及内置工具保持一致；相对已验收源码仅更新发布文档。

此前实机记录覆盖官服原版与带 Mod 多人游戏、北极星中国服菜单，以及在兼容 Mod 选择下的中外服认证和菜单检查，不代表已验证所有网络进入对局或每一个第三方 Mod 的实际效果。三服独立仅隔离 Mod 开关；原生插件和 DDS / VTF 文件仍共用。不会打包或修改用户个人 Mod 开关、游戏文件、日志或账号资料。
