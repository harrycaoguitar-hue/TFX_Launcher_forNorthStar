/* Cross-format transaction messages, without translating user resource names. */
(() => {
  'use strict';
  const pairs = [
    ['上次跨格式换肤尚未完成，请先在武器库中恢复。','The previous skin switch is incomplete. Recover it in the Arsenal first.'],
    ['跨格式恢复','Skin switch recovery'],
    ['跨格式皮肤恢复记录无法读取，请保留备份并修复记录','Skin switch recovery records could not be read. Keep the backups and repair the records.'],
    ['跨格式皮肤恢复记录无效，已停止资源写入','Invalid skin switch recovery record. Resource writes were stopped.'],
    ['另一个跨格式皮肤操作正在执行','Another skin switch is in progress'],
    ['请重新导入并校验皮肤包','Import and inspect the skin package again'],
    ['皮肤备份编号无效','Invalid skin backup ID'],
    ['上次 VTF 操作未完成，请先恢复该备份','The previous VTF operation is incomplete. Restore its backup first.'],
    ['VTF 索引备份校验失败，跨格式替换已取消','VTF index backup verification failed. The skin switch was cancelled.'],
    ['VTF 皮肤归档已被修改，跨格式替换已取消','The VTF skin archive was changed. The skin switch was cancelled.'],
    ['上次 DDS 操作未完成，请先恢复该备份','The previous DDS operation is incomplete. Restore its backup first.'],
    ['同一武器缺少经校验的 DDS 原版资源，请在 DDS 安装页面提供原版资源备份后重试','Verified original DDS data is missing for this weapon. Provide an original resource backup on the DDS page and try again.'],
    ['DDS 备份校验失败，跨格式替换已取消','DDS backup verification failed. The skin switch was cancelled.'],
    ['同一武器的 DDS 资源已被其他程序修改，未执行跨格式替换','Another program changed DDS data for this weapon. The skin switch was stopped.'],
    ['游戏已启动，跨格式换肤已取消','The game started. The skin switch was cancelled.'],
    ['游戏资源在备份后发生变化，跨格式换肤已取消','Game resources changed after the backup. The skin switch was cancelled.'],
    ['common 索引在备份后发生变化，跨格式换肤已取消','The common index changed after the backup. The skin switch was cancelled.'],
    ['跨格式恢复后的 DDS 校验失败','DDS verification failed after skin switch recovery.'],
    ['无法确认这份皮肤的武器归属，请先恢复已有皮肤或使用受支持的原版资源，再执行跨格式替换','The weapon for this skin could not be identified. Restore the existing skin or provide supported original resources before switching formats.'],
    ['正在清理同一武器的旧皮肤入口，其他武器保持不变','Restoring old skin paths for this weapon; keeping other weapons'],
    ['跨格式恢复编号无效','Invalid skin switch recovery ID'],
    ['跨格式恢复备份不存在','The skin switch recovery backup was not found'],
    ['这份跨格式备份已恢复','This skin switch backup was already restored'],
    ['这份旧皮肤已被跨格式换肤替代，请先恢复较新的跨格式备份，避免重新引入旧模型或皮肤','This skin was replaced by a later format switch. Restore the newer skin switch backup first.'],
    ['同一武器已有较新的皮肤，请先恢复较新的跨格式备份','A newer skin is installed for this weapon. Restore its skin switch backup first.'],
    ['跨格式恢复的 DDS 资源已变化，已停止恢复','DDS data changed after the skin switch. Restoration was stopped.'],
    ['跨格式索引备份校验失败','Skin switch index backup verification failed'],
    ['跨格式恢复的同一武器 VTF 入口已变化，已停止恢复','VTF paths changed after the skin switch. Restoration was stopped.'],
    ['请先退出游戏，再恢复跨格式皮肤备份','Close the game before restoring a skin switch backup'],
    ['皮肤武器归属不明确，已停止跨格式替换','The weapon could not be identified unambiguously. The skin switch was stopped.']
  ];
  window.VyraLocales.pairs.splice(window.VyraLocales.pairs.length-20,0,...pairs,
    ['DDS 资源目录无效','Invalid DDS resource catalogue'],
    ['DDS 资源目录存在无效位置','The DDS resource catalogue contains an invalid location'],
    ['DDS 资源目录存在重复位置','The DDS resource catalogue contains duplicate locations'],
    ['DDS 元数据请求超过支持范围','The DDS metadata request exceeds the supported limit']
  );
  window.VyraLocales.skinSwitchPatterns = [
    [/^皮肤备份已删除，历史跨格式数据将在下次清理时重试：(.+)$/u,'The skin backup was deleted. Historical cross-format data will be cleaned up on the next retry: $1'],
    [/^(.+) · 跨格式恢复$/u,'$1 · Skin switch recovery'],
    [/^跨格式皮肤恢复记录无法读取，请保留备份并修复记录：(.+)$/u,'Skin switch recovery records could not be read. Keep the backups and repair the records: $1'],
    [/^上次跨格式换肤未完成，请在 DDS 或 VTF 安装页面恢复「(.+)」备份后重试；恢复编号：(.+)$/u,'The previous skin switch is incomplete. Restore "$1" on the DDS or VTF page before retrying. Recovery ID: $2'],
    [/^同一武器的 VTF 资源已被其他程序修改，未执行跨格式替换：(.+)$/u,'Another program changed a VTF resource for this weapon. Skin switch stopped: $1'],
    [/^检测到未记录的同武器 VTF 覆盖，请先恢复原版 VPK 索引或验证游戏文件：(.+)$/u,'Untracked VTF changes were found for this weapon. Restore the original VPK index or verify game files first: $1'],
    [/^换肤未完成，请恢复跨格式皮肤备份；恢复编号：(.+)。(.+)$/u,'Skin switch incomplete. Restore the skin switch backup. Recovery ID: $1. $2'],
    [/^跨格式恢复校验失败，已保留恢复备份：(.+)$/u,'Skin switch recovery verification failed. The recovery backup was retained: $1'],
    [/^跨格式恢复的 common 索引发生冲突，已保留恢复备份：(.+)$/u,'The common index has a skin switch recovery conflict. The recovery backup was retained: $1'],
    [/^中断的跨格式恢复存在 DDS 冲突，请保留恢复备份：(.+)$/u,'The interrupted restore has a DDS conflict. Keep recovery backup: $1'],
    [/^中断的跨格式恢复存在 VTF 索引冲突，请保留恢复备份：(.+)$/u,'The interrupted restore has a VTF index conflict. Keep recovery backup: $1'],
    [/^格式切换：已恢复 (\d+) 个模型与材质入口、(\d+) 处 DDS 皮肤区域。$/u,'Format switch: restored $1 model/material paths and $2 DDS skin regions.']
  ];
})();
