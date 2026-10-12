import { DEVICE_COLORS, hashDeviceId, shortPhoneId } from '@/lib/ui/transfer/deviceColors';

/**
 * 带边框与专属底色的设备 ID 标签（v26.10.08-v12；v26.10.12-v1 随传输助手重构搬迁）。
 * 颜色下标由调用方传入（列表内已做撞色顺延，见 resolveDeviceColors）；不传则按哈希取。
 */
export default function DeviceIdTag({ id, colorIndex }: { id: string; colorIndex?: number }) {
    const idx = typeof colorIndex === 'number' ? colorIndex : hashDeviceId(id) % DEVICE_COLORS.length;
    const c = DEVICE_COLORS[idx];
    return (
        <span
            data-device-id={id}
            data-color-index={idx}
            style={{
                display: 'inline-block',
                padding: '1px 8px',
                borderRadius: 6,
                border: '1px solid ' + c.border,
                background: c.bg,
                color: c.color,
                lineHeight: '20px',
            }}>
            {shortPhoneId(id)}
        </span>
    );
}
