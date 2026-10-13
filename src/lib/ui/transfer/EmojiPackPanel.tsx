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
 *    交回调用方（设备会话**立刻发出去**，见 TransferDeviceChat 的 pickEmojiImage）——
 *    少一次网络往返，也没有「点了没反应」的空窗。
 *
 * ── 悬停放大预览（v26.10.13-v4）──────────────────────────────────────────────
 * 格子只有 30px，看不清表情细节：**鼠标停在格子上 0.5 秒**后弹出一个 120px 的放大浮层
 * （跟随光标、`pointerEvents:none` 不吃事件）；预览**已经在屏幕上时**移到别的格子**立即换图**，
 * 不再重新等 0.5 秒 —— 用户原话「在显示 hover 的情况下移动鼠标到其他表情包，实时显示」。
 *
 * ⚠️ 三个实现要点（都踩过或有原因）：
 *   a) 悬停判定用**网格上的 `mousemove` 委托**（`closest('.znhd-emoji-item')`），**不用每格的
 *      `onMouseEnter/onMouseLeave`**：React 的 enter/leave 是同一批 mouseover 里成对合成的，
 *      先派发 leave 再派发 enter ⇒ 移到相邻格子时会**先 close 再重新计时 0.5s**（「实时切换」失效）。
 *      委托只有一个来源，顺序问题不存在。
 *   b) 浮层 portal 到 `getPreviewHost()`（共享层的预览宿主，挂在 documentElement 下）：
 *      税务页 body 常带 transform，挂 body 的 fixed 浮层会以 body 盒子为包含块 → 坐标全错。
 *   c) 「是否已在显示」用 **ref**（`hoverShown`）而不是读 state：mousemove 每秒几十次，
 *      用 state 判会读到闭包里的旧值，切换逻辑会退化成重新计时。
 */

import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { createPortal } from 'react-dom';
import { Button, Spin, theme } from 'antd';
import {
    cachedEmojiBlob,
    loadEmojiBlob,
    loadEmojiPacks,
    type EmojiItem,
    type EmojiPack,
} from '@/lib/transfer/emojiPack';
import { getPreviewHost } from '../../../../shared/preview/host';

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
/** 悬停多久后弹出放大预览（用户要求 0.5s：扫过格子时不该闪出大图） */
const HOVER_DELAY = 500;
/** 放大预览的方形边长（含内边距） */
const HOVER_BOX = 120;
/** 预览相对光标的偏移 */
const HOVER_OFFSET = 16;
/** 浮层的 z-index：要盖住 Popover（antd zIndexPopupBase = 1000000） */
const HOVER_Z = 1000001;

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
    /** 放大预览（null = 不显示）：url 为被悬停的那张，x/y 是光标视口坐标 */
    const [hover, setHover] = useState<{ url: string; x: number; y: number } | null>(null);
    /** 0.5s 计时器 */
    const hoverTimer = useRef<number | null>(null);
    /** 正在等待计时的那张（同一张继续等，不重置计时） */
    const hoverPending = useRef('');
    /** 预览是否已在屏幕上 —— 为 true 时移到别的格子**立即换图**（不再等 0.5s） */
    const hoverShown = useRef(false);
    /** 最后一次鼠标位置（计时结束时用它定位，而不是计时开始时的旧位置） */
    const hoverPos = useRef({ x: 0, y: 0 });

    const clearHoverTimer = () => {
        if (hoverTimer.current !== null) {
            window.clearTimeout(hoverTimer.current);
            hoverTimer.current = null;
        }
    };

    /** 收起预览（鼠标移出网格 / 移到空白处）：下一次悬停要重新等 0.5s */
    const closeHover = () => {
        clearHoverTimer();
        hoverPending.current = '';
        hoverShown.current = false;
        setHover(null);
    };

    // 面板被关掉（Popover 卸载）时清掉挂起的计时器，别让它在卸载后 setState
    useEffect(() => () => clearHoverTimer(), []);

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
    /** url → 中继路径（v26.10.14-v3：表情图优先走中继；悬停补图时按 url 反查 path 用） */
    const pathByUrl = useMemo(() => {
        const map: Record<string, string> = {};
        (activePack ? activePack.items : []).forEach((it) => {
            if (it.path) map[it.url] = it.path;
        });
        return map;
    }, [activePack]);

    // 当前合集的图片：缓存命中的同步填，其余分批下载（切组合集会取消上一轮）
    useEffect(() => {
        if (!activePack) return;
        let cancelled = false;
        const cached: Record<string, string> = {};
        const queue: EmojiItem[] = [];
        activePack.items.forEach((it) => {
            const hit = cachedEmojiBlob(it.url, it.path);
            if (hit) cached[it.url] = hit.objectUrl;
            else queue.push(it);
        });
        if (Object.keys(cached).length) setReady((prev) => ({ ...prev, ...cached }));

        const run = async () => {
            while (queue.length && !cancelled) {
                const batch = queue.splice(0, BATCH);
                const results = await Promise.allSettled(batch.map((it) => loadEmojiBlob(it.url, it.path)));
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
        const hit = cachedEmojiBlob(it.url, it.path);
        if (hit) {
            onPick({ pack: activePack.name, key: it.key, url: it.url, name: it.name, blob: hit.blob });
            return;
        }
        // 还没下好（用户手比下载快）：等这张下完再交出去 —— 别让点击石沉大海。
        // ⚠️ 不把未就绪的格子做成 disabled：disabled 的按钮点了完全没反馈，用户只会以为坏了。
        setPendingKey(it.url);
        loadEmojiBlob(it.url, it.path)
            .then((entry) =>
                onPick({ pack: activePack.name, key: it.key, url: it.url, name: it.name, blob: entry.blob })
            )
            .catch(() => {
                /* 下载失败：格子保持占位，用户可重试或点刷新 */
            })
            .finally(() => setPendingKey((k) => (k === it.url ? '' : k)));
    };

    /**
     * 网格上的鼠标移动（委托）：更新预览位置 / 切换预览目标。
     * 见文件头 a) —— 这里刻意不用每格的 onMouseEnter/onMouseLeave。
     */
    const onGridMove = (e: ReactMouseEvent<HTMLDivElement>) => {
        const target = e.target as HTMLElement | null;
        const cell = target ? (target.closest('.znhd-emoji-item') as HTMLElement | null) : null;
        const url = cell ? cell.getAttribute('data-emoji-url') || '' : '';
        hoverPos.current = { x: e.clientX, y: e.clientY };
        if (!url) {
            // 网格的空白处：已显示的收起，正在计时的作废
            if (hoverShown.current) closeHover();
            else clearHoverTimer();
            return;
        }
        if (hoverShown.current) {
            // 预览已在屏幕上 → 实时换图（用户要求的「实时通过 hover 显示其他表情包」）
            setHover({ url, x: e.clientX, y: e.clientY });
            return;
        }
        if (hoverPending.current === url) return; // 同一格继续等，别重置计时
        clearHoverTimer();
        hoverPending.current = url;
        hoverTimer.current = window.setTimeout(() => {
            hoverTimer.current = null;
            hoverShown.current = true;
            setHover({ url, x: hoverPos.current.x, y: hoverPos.current.y });
        }, HOVER_DELAY);
    };

    // 悬停的那张还没下好（面板分批下载中）：补一次，到位后浮层自己换成图
    // （v26.10.14-v3：带上中继路径，别绕过中继直连 CDN）
    useEffect(() => {
        if (!hover || ready[hover.url]) return;
        let alive = true;
        loadEmojiBlob(hover.url, pathByUrl[hover.url])
            .then((entry) => {
                if (alive) setReady((prev) => ({ ...prev, [hover.url]: entry.objectUrl }));
            })
            .catch(() => {
                /* 下载失败：浮层留在加载态，移开即消失 */
            });
        return () => {
            alive = false;
        };
    }, [hover, ready, pathByUrl]);

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
                onMouseMove={onGridMove}
                onMouseLeave={closeHover}
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
                            // 悬停预览委托靠它反查是哪一张（见 onGridMove）
                            data-emoji-url={it.url}
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
                点表情直接发送到手机 · 悬停 0.5 秒放大查看
            </div>
            {/* 悬停放大预览：portal 到共享预览宿主（挂 documentElement，避开 body transform） */}
            {hover
                ? createPortal(
                      <div
                          className="znhd-emoji-hover"
                          data-emoji-url={hover.url}
                          aria-hidden="true"
                          style={{
                              position: 'fixed',
                              // 跟随光标 + 视口夹紧（贴边时不越界）
                              left: Math.max(8, Math.min(hover.x + HOVER_OFFSET, window.innerWidth - HOVER_BOX - 8)),
                              top: Math.max(8, Math.min(hover.y + HOVER_OFFSET, window.innerHeight - HOVER_BOX - 8)),
                              width: HOVER_BOX,
                              height: HOVER_BOX,
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              background: 'rgba(0,0,0,0.78)',
                              border: '1px solid rgba(255,255,255,0.16)',
                              borderRadius: 10,
                              boxShadow: '0 8px 24px rgba(0,0,0,0.55)',
                              // 不吃鼠标事件：浮层压在别的格子上也不会打断「移到下一张」
                              pointerEvents: 'none',
                              zIndex: HOVER_Z,
                          }}>
                          {ready[hover.url] ? (
                              <img
                                  src={ready[hover.url]}
                                  alt=""
                                  style={{ maxWidth: HOVER_BOX - 16, maxHeight: HOVER_BOX - 16, display: 'block' }}
                              />
                          ) : (
                              <Spin size="small" />
                          )}
                      </div>,
                      getPreviewHost()
                  )
                : null}
        </div>
    );
}
