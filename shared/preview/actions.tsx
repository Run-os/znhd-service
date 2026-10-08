/**
 * 往 antd 图片预览的工具栏里追加按钮 —— 两端共用（v26.10.08-v13 起）。
 *
 * ⚠️ **必须用 `cloneElement` 把按钮追加进 antd 自己的 `.ant-image-preview-actions` 容器**，
 *    不能把按钮当 `originalNode` 的兄弟节点返回：
 *      · 工具栏的胶囊背景与圆角长在 `actions` 容器上，而它的父级 `footer` 是 `flex-direction: column`
 *        ⇒ 放外面会变成「工具栏下方一个没有背景的裸按钮」；
 *      · 复用 antd 自己的 `ant-image-preview-actions-action` 类，尺寸/悬停与自带图标完全一致。
 *
 * 用法（两端都一样）：
 * ```tsx
 * preview={{ actionsRender: (node) => appendPreviewActions(node, <button …>…) }}
 * ```
 */
import { Children, cloneElement, isValidElement, type ReactElement, type ReactNode } from 'react';

/** antd 传给 actionsRender 的原始节点（就是那个 actions 容器） */
export function appendPreviewActions(originalNode: ReactNode, extra: ReactNode): ReactNode {
    if (!isValidElement(originalNode)) return originalNode;
    const node = originalNode as ReactElement<{ children?: ReactNode }>;
    return cloneElement(node, {}, [...Children.toArray(node.props.children), extra]);
}
