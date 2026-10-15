# TFX 1.0.3: installation feedback and launch diagnostics

These features are included in the stable 1.0.3 release. The filename is retained for existing links. See the main README for the unified installer, Arsenal and regional Mod settings.

## Skin installation preview

The unified installer recognizes compatible DDS, VTF and Northstar Mod packages by their contents. For DDS / VTF skins it can report the resources it plans to write, previous resources it plans to restore, and conflicts demonstrated from enabled Mod files. The details are informational: automatic installation revalidates the selected package and current game state before writing.

Resource names and locations are evidence, not a visual preview of how a weapon will look. TFX does not invent part names for unrecognized resources. Unsupported layouts, incomplete scans and missing recovery sources must be shown as limitations, rather than a guarantee that no conflict exists. Packed resources and changes made outside TFX may not be fully identifiable.

Planning does not write game resources. A valid package proceeds to its installer automatically; invalid, ambiguous or incomplete packages stop with an explanation. Existing installation and recovery safeguards still apply.

## Launch diagnostics

The launch page shows observed stages for the current attempt. A failed attempt retains its result for inspection. Process creation and Northstar readiness are separate observations; merely starting a process is not sufficient to confirm that the Northstar menu loaded.

Where the evidence does not establish the underlying cause, TFX says so and suggests checks instead of identifying a guessed culprit. Diagnostics do not automatically disable mods or reinstall the game.

Open the diagnostic details to review the redacted JSON before exporting it. Export saves the reviewed snapshot to a file chosen by the user. TFX does not upload the file or open an Issue automatically. Review the exported content before sharing it publicly; the report deliberately excludes raw launch arguments, personal file paths and authentication data.

## 中文说明

这些功能已包含在 1.0.3 正式版中。文件名保留以兼容原有链接；统一安装、武器库和双服模组独立设置的说明请见主 README。

统一入口根据内容自动识别 DDS、VTF 和北极星 Mod。皮肤检查可以列出新包将写入的资源、计划恢复的旧资源，以及能够确认的已启用模组冲突。计划阶段不写入游戏资源；有效包通过校验后自动进入对应安装流程，格式错误、内容混杂或资源不完整时会说明原因。安装提交前仍会重新检查当前选择和游戏状态。不完整检查会标明范围，不能把它理解为“绝对没有冲突”。

启动诊断按实际观察展示阶段。启动进程出现与北极星菜单就绪是两个不同状态；无法确定失败原因时，会明确说明并给出检查建议，不会猜测某个模组一定有问题，也不会自动关闭模组或重装游戏。

诊断详情先展示脱敏后的 JSON，确认内容后再选择保存位置。导出保留你查看的那一份快照，不自动上传或提交 Issue；公开分享前仍建议自行检查。

## Clear import and installation feedback

Dropping a package immediately shows its name in the left import panel while validation runs. Invalid imports remain clearly marked and cannot reuse the previous selection. Installation shows activity immediately, follows available installer progress and reaches completion only after the installation result succeeds. The lower-right notification confirms successful completion.

## 导入与安装反馈

拖入包后，左侧立即显示文件名和检查状态；格式错误会保留当前文件的失败提示，不沿用上一次选择。校验通过后自动安装，过程中持续显示进度，收到安装成功结果后才显示 100%，并在右下角通知完成。
