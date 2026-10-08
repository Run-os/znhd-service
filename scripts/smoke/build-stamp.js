/**
 * 产物构建戳（v26.10.08-v9）。
 *
 * 为什么需要它：`npm run build` 失败时 **webpack 不会更新 dist，旧产物还在**，
 * 于是 `npm run verify` 会静默地拿**旧 bundle** 跑测试 —— v26.10.08-v8 就踩过：
 * tsc 报错（uiReset 模板串被反引号截断）导致构建失败，紧接着的 verify 对着旧产物报红，
 * 一度被误读成「修复没生效」。
 *
 * ⚠️ 为什么不用 mtime：webpack 的 `compareBeforeEmit`（默认开）在**输出内容没变时不会重写文件**，
 * 于是「构建成功」也不代表 dist 的 mtime 会变新 —— 实测这样会产生**假阳性**
 * （只碰了源码时间戳、内容未变，重建后 verify 会一直报「产物比源码旧」）。
 *
 * 做法：把「构建输入的内容哈希」写在 `dist/.build-stamp`，`npm run build` 成功后写入、
 * verify 前比对。内容哈希对「时间戳变化」「构建有没有真的跑成功」都免疫。
 *
 * 用法：`node scripts/smoke/build-stamp.js write`（build 后调用）/ `check`（verify 前调用）
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..', '..');
const STAMP = path.join(ROOT, 'dist', '.build-stamp');

/** 收集所有会影响 dist 产物的输入文件（脚本源码 + 版本号 + 元信息） */
function collectInputs() {
    const srcDir = path.join(ROOT, 'src');
    const files = fs
        .readdirSync(srcDir, { recursive: true })
        .map((p) => path.join(srcDir, String(p)))
        .filter((f) => /\.(ts|tsx)$/.test(f) && fs.existsSync(f) && fs.statSync(f).isFile())
        .concat([path.join(ROOT, 'package.json'), path.join(ROOT, 'config', 'common.meta.json')])
        .filter((f) => fs.existsSync(f));
    return files.sort();
}

/** 构建输入的内容哈希（与文件时间戳无关） */
function hashInputs() {
    const h = crypto.createHash('sha256');
    for (const f of collectInputs()) {
        // 路径也纳入：新增/删除源文件必须改变哈希（否则删掉一个文件、其余不变时哈希会漏判）
        h.update(path.relative(ROOT, f).replace(/\\/g, '/'));
        h.update('\0');
        h.update(fs.readFileSync(f));
        h.update('\0');
    }
    return h.digest('hex');
}

function readStamp() {
    try {
        return String(fs.readFileSync(STAMP, 'utf8')).trim();
    } catch (e) {
        return '';
    }
}

function writeStamp() {
    const h = hashInputs();
    fs.mkdirSync(path.dirname(STAMP), { recursive: true });
    fs.writeFileSync(STAMP, h + '\n');
    return h;
}

module.exports = { ROOT, STAMP, collectInputs, hashInputs, readStamp, writeStamp };

if (require.main === module) {
    const mode = process.argv[2] || 'check';
    if (mode === 'write') {
        const h = writeStamp();
        console.log('[构建戳] 已记录当前源码哈希 ' + h.slice(0, 12) + '（verify 会用它判断 dist 是否过期）');
        process.exit(0);
    }
    const now = hashInputs();
    const stamped = readStamp();
    if (now !== stamped) {
        console.error(
            '❌ dist/znhd.user.js 与当前源码不一致 —— 说明上次 `npm run build` 没成功（或没跑）。\n' +
                '   ⚠️ 构建失败时旧产物仍在，直接跑 verify 会**静默地测试旧 bundle**，很容易误判改动是否生效。\n' +
                '   请先执行 `npm run build` 并确认它输出 `compiled successfully` 再重试。'
        );
        process.exit(1);
    }
    process.exit(0);
}
