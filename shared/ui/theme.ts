/**
 * 品牌色单一事实源（v26.10.25-v8）。
 *
 * 两端 UI（脚本端影子树 + 客户端手机上传页）的 `--znhd-*` 品牌自定义属性
 * 此前在 `src-vue/style.css` 与 `web/src/style.css` 各手抄一份色值，改配色要
 * 两边一起动、还容易漂移。v8 起色值只在这里维护，两端入口（脚本端
 * `main.ts` / `navBarMount.ts` / `mountQuickBar.ts`，客户端 `web/src/main.ts`）
 * 在**首帧前**调 `applyThemeVars()` 把它们注入宿主元素：
 *
 *   · 脚本端挂在 shadow host 上 —— 自定义属性经扁平树继承进整棵影子树
 *     （含 Teleport 到 shadowRoot 的 ImagePreview，它们是 #app 的兄弟节点，
 *     挂 #app 会漏；挂 host 与原 `:host { --znhd-* }` 声明等价且更早生效）；
 *   · 客户端挂 `document.documentElement`（整页单树，一次覆盖）。
 *
 * CSS 里只保留 `var()` 使用点，不再声明色值；样式表先于注入加载也没有关系
 * —— 自定义属性在**计算值阶段**才做 var() 替换，入口同步注入先于任何元素渲染，
 * 不会出现 FOUC / 掉色。
 *
 * ⚠️ 透明度档位不用 color-mix（Chrome 88 基线不支持，Chrome 111 才有）：
 * `dangerSoft` / `dangerLine` 直接写 CSS Color 4 的 `rgb(R G B / A)` 斜杠语法
 * （Chrome 65+ / FF 52+ / Safari 12.1+，基线安全）。
 */
export const THEME = {
    /** 品牌蓝：主题 primary / toggle 选中底 / 导航条开关（v8 用户定版） */
    brand: 'rgb(66, 133, 244)',
    /** 我方气泡绿（日间，v11 用户定版） */
    bubbleMine: 'rgb(53, 210, 141)',
    /** 危险红（删除 / 清空等破坏性动作，v26.10.25-v8 变量化） */
    danger: '#ff7875',
    /** 危险红 hover 浅底（≈ danger 的 15% 透明度） */
    dangerSoft: 'rgb(255 120 117 / 0.15)',
    /** 危险红描边（≈ danger 的 50% 透明度） */
    dangerLine: 'rgb(255 120 117 / 0.5)',
} as const;

/** THEME → CSS 自定义属性名映射（两端注入共用同一份，防止漏注 / 改名漂移） */
const THEME_VARS: Readonly<Record<string, string>> = {
    '--znhd-brand': THEME.brand,
    '--znhd-bubble-mine': THEME.bubbleMine,
    '--znhd-danger': THEME.danger,
    '--znhd-danger-soft': THEME.dangerSoft,
    '--znhd-danger-line': THEME.dangerLine,
};

/**
 * 把全部品牌自定义属性注入到目标元素（内联 style，优先级高于任何样式表规则）。
 * 必须在该元素的首帧渲染前调用（入口同步执行即满足）。
 */
export function applyThemeVars(el: HTMLElement): void {
    for (const [name, value] of Object.entries(THEME_VARS)) {
        el.style.setProperty(name, value);
    }
}
