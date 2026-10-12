/**
 * 在线表情包面板（v26.10.13-v3）—— `ChatComposer` 表情按钮的 Popover 内容。
 *
 * 结构：顶部一行合集 chips（可横向滚动）+ 右上角「刷新」→ 中间图片网格 → 底部一行提示。
 * 数据层在 `@/lib/transfer/emojiPack`（清单缓存 / GM 拉取 / blob 复用，理由写在那边）。
 *
 * ── 三个实现要点 ────────────────────────────────────────────────────────────
 * 1. **分批下载**：合集最多 134 张，一次并发 8 张 → 首屏很快就有图，剩下的在后台补。
 *    已下好的（blob 缓存命中）同步填进去，切走再切回来是秒开。
 * 2. **合集用 chips 而不是下拉**：Popover 里再套一层 antd Select/下拉，点开时会被
 *    Popover 的「点外部关闭」逻辑抢走点击（要额外配 getPopupContainer），chips 没这个问题。
 * 3. **点击时直接交 blob**（不再二次下载）：面板显示本来就下过这张图，`onPick` 把 blob 一起
 *    交回调用方，设备会话据此构造 File 入待发列表 —— 少一次网络往返，也没有「点了没反应」的空窗。
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Spin, theme } from 'antd';
import {
    cachedEmojiBlob,
    loadEmojiBlob,
    loadEmojiPacks,
    type EmojiItem,
    type EmojiPack,
} from '@/lib/transfer/emojiPack';

/** 用户点选的一张表情（blob 已就绪，调用方直接拿去构造 File） */
export interface PickedEmoji {
    /** 合集显示名（用于日志/文件名前缀说明） */
    pack: string;
    /** 合集内的键 */
    key: string;
    /** 原图地址 */
    url: string;
    /** 发送到手机时用的文件名 */
    name: string;
    blob: Blob;
}

const PANEL_WIDTH = 300;
/** 每批并发下载的张数：太多会瞬间打满连接，太少首屏出图慢 */
const BATCH = 8;

export default function EmojiPackPanel({ onPick }: { onPick: (emoji: PickedEmoji) => void }) {
    const { token } = theme.useToken();
    const [packs, setPacks] = useState<EmojiPack[] | null>(null);
    const [err, setErr] = useState('');
    const [activeId, setActiveId] = useState('');
    const [busy, setBusy] = useState(false);
    /** url -> objectURL（已下好的图） */
    const [ready, setReady] = useState<Record<string, string>>({});
    /** 正在临时补下载的那张（用户点得比下载快） */
    const [pendingKey, setPendingKey] = useState('');

    const load = useCallback((force: boolean) => {
        setBusy(true);
        setErr('');
        loadEmojiPacks(force)
            .then((list) => {
                setPacks(list);
                // 默认选第一组；刷新后尽量留在原来的组
                setActiveId((prev) => (prev && list.some((p) => p.id === prev) ? prev : list[0].id));
            })
            .catch((e: { message?: string }) => setErr((e && e.message) || '表情包加载失败'))
            .finally(() => setBusy(false));
    }, []);

    useEffect(() => {
        load(false);
    }, [load]);

    const activePack = useMemo(() => (packs || []).find((p) => p.id === activeId) || null, [packs, activeId]);

    // 当前合集的图片：缓存命中的同步填，其余分批下载（切组合集会取消上一轮）
    useEffect(() => {
        if (!activePack) return;
        let cancelled = false;
        const cached: Record<string, string> = {};
        const queue: EmojiItem[] = [];
        activePack.items.forEach((it) => {
            const hit = cachedEmojiBlob(it.url);
            if (hit) cached[it.url] = hit.objectUrl;
            else queue.push(it);
        });
        if (Object.keys(cached).length) setReady((prev) => ({ ...prev, ...cached }));

        const run = async () => {
            while (queue.length && !cancelled) {
                const batch = queue.splice(0, BATCH);
                const results = await Promise.allSettled(batch.map((it) => loadEmojiBlob(it.url)));
                if (cancelled) return;
                const add: Record<string, string> = {};
                results.forEach((r, i) => {
                    if (r.status === 'fulfilled') add[batch[i].url] = r.value.objectUrl;
                });
                if (Object.keys(add).length) setReady((prev) => ({ ...prev, ...add }));
            }
        };
        void run();
        return () => {
            cancelled = true;
        };
    }, [activePack]);

    const pick = (it: EmojiItem) => {
        if (!activePack) return;
        const hit = cachedEmojiBlob(it.url);
        if (hit) {
            onPick({ pack: activePack.name, key: it.key, url: it.url, name: it.name, blob: hit.blob });
            return;
        }
        // 还没下好（用户手比下载快）：等这张下完再交出去 —— 别让点击石沉大海。
        // ⚠️ 不把未就绪的格子做成 disabled：disabled 的按钮点了完全没反馈，用户只会以为坏了。
        setPendingKey(it.url);
        loadEmojiBlob(it.url)
            .then((entry) =>
                onPick({ pack: activePack.name, key: it.key, url: it.url, name: it.name, blob: entry.blob })
            )
            .catch(() => {
                /* 下载失败：格子保持占位，用户可重试或点刷新 */
            })
            .finally(() => setPendingKey((k) => (k === it.url ? '' : k)));
    };

    const chip = (pack: EmojiPack) => {
        const on = pack.id === activeId;
        return (
            <Button
                key={pack.id}
                size="small"
                type="text"
                aria-pressed={on}
                onClick={() => setActiveId(pack.id)}
                style={{
                    flex: '0 0 auto',
                    height: 22,
                    padding: '0 8px',
                    fontSize: 12,
                    borderRadius: 11,
                    background: on ? 'rgba(7,193,96,0.18)' : 'rgba(255,255,255,0.06)',
                    color: on ? '#07C160' : 'rgba(255,255,255,0.75)',
                }}>
                {pack.name}
            </Button>
        );
    };

    const body = () => {
        if (err) {
            return (
                <div style={{ padding: '18px 0', textAlign: 'center' }}>
                    <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.55)', marginBottom: 8 }}>{err}</div>
                    <Button size="small" onClick={() => load(true)}>
                        重试
                    </Button>
                </div>
            );
        }
        if (!packs) {
            return (
                <div style={{ padding: '22px 0', textAlign: 'center' }}>
                    <Spin size="small" />
                    <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.45)', marginTop: 8 }}>正在加载表情包…</div>
                </div>
            );
        }
        return (
            <div
                style={{
                    maxHeight: 196,
                    overflowY: 'auto',
                    display: 'grid',
                    gridTemplateColumns: 'repeat(8, minmax(0, 1fr))',
                    gap: 2,
                }}>
                {(activePack ? activePack.items : []).map((it) => {
                    const url = ready[it.url];
                    return (
                        <button
                            key={it.url}
                            type="button"
                            className="znhd-emoji-item"
                            aria-label={'表情 ' + it.name}
                            title={it.key}
                            aria-busy={pendingKey === it.url}
                            onClick={() => pick(it)}
                            style={{
                                width: 30,
                                height: 30,
                                padding: 0,
                                border: 'none',
                                borderRadius: 4,
                                background: url ? 'transparent' : 'rgba(255,255,255,0.05)',
                                opacity: pendingKey === it.url ? 0.45 : 1,
                                display: 'inline-flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                cursor: 'pointer',
                            }}>
                            {url ? (
                                <img src={url} alt={it.key} style={{ maxWidth: 26, maxHeight: 26, display: 'block' }} />
                            ) : null}
                        </button>
                    );
                })}
            </div>
        );
    };

    return (
        <div style={{ width: PANEL_WIDTH }} className="znhd-emoji-panel">
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                <div style={{ flex: '1 1 auto', display: 'flex', gap: 4, overflowX: 'auto', paddingBottom: 2 }}>
                    {(packs || []).map(chip)}
                </div>
                <Button
                    size="small"
                    type="text"
                    aria-label="刷新表情包"
                    disabled={busy}
                    onClick={() => load(true)}
                    style={{
                        flex: '0 0 auto',
                        height: 22,
                        padding: '0 4px',
                        fontSize: 12,
                        color: token.colorTextTertiary,
                    }}>
                    刷新
                </Button>
            </div>
            {body()}
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', marginTop: 6 }}>
                点表情先放进「待发图片」，再点发送发出去
            </div>
        </div>
    );
}
