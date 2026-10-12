/**
 * 手机端在线表情面板（v26.10.13-v3）—— 输入区工具栏「表情」按钮展开的内嵌面板。
 *
 * 与脚本端 `EmojiPackPanel`（Popover 浮层 + 悬停放大预览）的差异：
 *   · 手机页是**内嵌**在输入区里（工具栏上方），不用 Popover —— 触屏没有 hover，
 *     「悬停 0.5s 放大预览」在触屏上无从触发，做了也用不上；
 *   · 结构保持同款：顶部合集 chips（可横滑）+「刷新」→ 8 列图片网格 → 底部提示，
 *     数据层 `web/src/lib/emojiPack.ts` 与脚本端共用同一份 8 合集清单；
 *   · 点一张 = 直接把 blob 交回调用方（App.tsx 随即 base64 POST 到中继），
 *     与脚本端「点表情直接发送」同语义。
 *
 * 分批下载：合集最多 134 张，一次并发 8 张 → 首屏很快就有图，剩下的后台补；
 * 已下好的（缓存命中）同步填进去，切走再切回来秒开。
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
    cachedEmojiBlob,
    loadEmojiBlob,
    loadEmojiPacks,
    type EmojiItem,
    type EmojiPack,
    type PickedEmoji,
} from './lib/emojiPack';

/** 每批并发下载的张数：太多瞬间打满连接，太少首屏出图慢（与脚本端一致） */
const BATCH = 8;

export default function EmojiPanel({ onPick }: { onPick: (emoji: PickedEmoji) => void }) {
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

    const body = () => {
        if (err) {
            return (
                <div className="znhd-emoji-state">
                    <div>{err}</div>
                    <button type="button" className="znhd-emoji-retry" onClick={() => load(true)}>
                        重试
                    </button>
                </div>
            );
        }
        if (!packs) {
            return <div className="znhd-emoji-state">正在加载表情包…</div>;
        }
        return (
            <div className="znhd-emoji-grid">
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
                            onClick={() => pick(it)}>
                            {url ? <img src={url} alt={it.key} /> : null}
                        </button>
                    );
                })}
            </div>
        );
    };

    return (
        <div className="znhd-emoji-panel">
            <div className="znhd-emoji-chips">
                <div className="znhd-emoji-chips-scroll">
                    {(packs || []).map((p) => (
                        <button
                            key={p.id}
                            type="button"
                            className="znhd-emoji-chip"
                            aria-pressed={p.id === activeId}
                            onClick={() => setActiveId(p.id)}>
                            {p.name}
                        </button>
                    ))}
                </div>
                <button
                    type="button"
                    className="znhd-emoji-refresh"
                    aria-label="刷新表情包"
                    disabled={busy}
                    onClick={() => load(true)}>
                    刷新
                </button>
            </div>
            {body()}
            <div className="znhd-emoji-tip">点表情直接发送到电脑</div>
        </div>
    );
}
