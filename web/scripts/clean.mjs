/**
 * 构建前清理产物目录。
 *
 * ⚠️ 两个坑（都实测过，别改回去）：
 *  1) 不能用 Vite 的 emptyOutDir：产出目录在项目根之外（../relay-server/public），Vite 不会清空它，
 *     上一版带 hash 的旧文件会一直堆积并提交进仓库；
 *  2) 不能用 fs.rmSync(dir, { recursive: true })：在 Windows + 中文路径下它**不报错但也不删除**
 *     （实测 still exists=true），必须逐项 unlink + rmdir。
 */
import { readdirSync, rmdirSync, unlinkSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const target = fileURLToPath(new URL('../../relay-server/public', import.meta.url));

/** 手工递归删除：先删子项再删目录（规避 rmSync 静默失效） */
function removeRecursive(dir) {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir)) {
        const child = path.join(dir, entry);
        let isDir = false;
        try {
            readdirSync(child);
            isDir = true;
        } catch {
            isDir = false;
        }
        if (isDir) removeRecursive(child);
        else unlinkSync(child);
    }
    rmdirSync(dir);
}

removeRecursive(target);
console.log('[web] 已清理构建目录:', target, '剩余存在:', existsSync(target));
