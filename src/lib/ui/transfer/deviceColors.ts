/**
 * 设备 ID 的展示工具。
 *
 * 历史：v26.10.08-v12 曾给设备 ID 加彩色边框标签（固定色板 + 哈希取模，
 * `<DeviceIdTag>` 组件的配色来源）；v26.10.20-v16 按用户要求**取消标签样式、
 * 改为纯文本**，标签组件与整套色板（`DEVICE_COLORS` / `hashDeviceId` /
 * `resolveDeviceColors`）一并删除，这里只留下仍在用的 `shortPhoneId`。
 */

/** 手机 ID 的展示用短串（UUID 太长，取前 8 位） */
export function shortPhoneId(id: string): string {
    if (!id) return '未知设备（旧版中继）';
    return id.length > 8 ? id.slice(0, 8) + '…' : id;
}
