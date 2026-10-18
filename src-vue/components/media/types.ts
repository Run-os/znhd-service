import type { IconName } from '@vue/icons';

/**
 * 图片格子右下角的悬浮动作（`ImageActions.vue` 的入参）。
 * 单独放 .ts 是因为 `<script setup>` 不能导出类型。
 */
export interface ImageAction {
    label: string;
    /** hover 提示，默认取 label */
    tooltip?: string;
    icon: IconName;
    onClick: () => void;
    danger?: boolean;
    loading?: boolean;
}
