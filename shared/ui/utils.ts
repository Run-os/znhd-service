/**
 * shadcn 的 `cn` helper（v26.10.09-v3 起）。
 *
 * ── 为什么这里只有一行 re-export ──────────────────────────────────────────
 * shadcn 官方 manual 安装步骤写明：组件 `import { cn } from "cn"`，并建议
 * `export { cn } from "cn"` 统一到 `lib/utils.ts`，让业务代码有单一的引用位置。
 * 本仓库把 shadcn 组件放在两端共用的 `shared/ui/`，故 utils 落在这里
 * （`components.json` 的 `aliases.utils` = `@ui/utils`）。
 *
 * ── 与旧 `./cn` 的关系 ───────────────────────────────────────────────────
 * `shared/ui/cn.ts` 是本项目手写的一份 20 行实现（当时为遵守「零宿主依赖」）。
 * **它不做 Tailwind 类冲突合并**，而 shadcn 组件大量依赖 `cn(base, className)` 中
 * `className` 能覆盖 `base`（例如把 `bg-primary` 换成 `bg-destructive`）。
 * 纯字符串拼接时两个类会同时留在 class 属性上，谁生效取决于 CSS 里的先后顺序 ——
 * 结果是**外部传入的 className 覆盖不掉组件内置样式**，shadcn 的 variant 体系直接失效。
 * 故 shadcn 组件一律走这里（带冲突合并）；旧 `cn.ts` 保留给非 shadcn 的自研组件。
 *
 * ⚠️ 新增 shadcn 组件时请 import 本文件，不要 import './cn'。
 */
export { cn } from 'cn';
