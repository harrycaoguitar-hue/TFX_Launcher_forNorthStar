# TFX Launcher 1.0.5

## 中文

- 优化启动前的代理恢复检查：仅在需要校验代理组件时读取客户端清单。没有待恢复记录、没有相关代理文件时，不再被无关的清单读取错误阻断。
- 修正启动诊断阶段：换肤检查完成后的启动状态恢复错误归入预检，避免误报为皮肤失败。
- 保留未完成换肤、异常恢复记录、缺失备份及未知代理的保护机制。
- 补齐新增恢复提示的多语言映射，应用与 Windows 文件版本统一为 1.0.5。

## English

- Load trusted proxy manifests only when proxy verification is required. No-op startup recovery no longer depends on unrelated client manifests.
- Attribute post-skin-check recovery failures to preflight instead of reporting them as skin failures.
- Retain safeguards for interrupted skin operations, invalid recovery records, missing backups and unknown proxies.
- Add localized recovery guidance and synchronize application/native versions to 1.0.5.

## Validation / 验证

900 automated tests passed; 0 failures, 0 skipped. Includes a regression for missing manifests with no recovery work, and rejection when verification is actually required. Baseline/modified/rollback checks also verified the local patch.

本次没有新增完整进游戏实机验证。原始诊断没有记录缺失路径，因此不能保证覆盖所有 ENOENT 启动问题。No new end-to-end live game launch was verified; this release does not claim to resolve every ENOENT error.

Windows x64 portable executable; unsigned. Keep your existing game installation and settings. SHA256SUMS.txt accompanies the release assets. Source and third-party licenses are included in the source archive.
