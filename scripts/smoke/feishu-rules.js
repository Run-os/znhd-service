/**
 * 飞书规则表「列名解析」纯逻辑冒烟（v26.10.26-v1）。
 *
 * 为什么单独一套：`src/lib/feishu/rules.ts` 是零宿主依赖的纯逻辑（网络走注入的 http），
 * 用假 http 打真实代码，几秒覆盖「标题/内容列别名 / 包含匹配 / 无标题列回退标记 / 标签·排除词·常显」。
 *
 * 背景（2026-10-26 真机问题）：隐私信息表第一列不叫「标题」，`title` 落进
 * 「内容前 12 字」回退 ⇒ 快捷短语栏显示的是被截断的正文。本冒烟钉死别名解析行为。
 *
 * 判据：所有 check 必须为 true，否则退出码 1。
 */
const esbuild = require('esbuild');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');

const built = esbuild.buildSync({
    entryPoints: [path.join(ROOT, 'src/lib/feishu/rules.ts')],
    bundle: true,
    format: 'cjs',
    platform: 'node',
    write: false,
    logLevel: 'silent',
});
const mod = { exports: {} };
// eslint-disable-next-line no-new-func
new Function('module', 'exports', 'require', built.outputFiles[0].text)(mod, mod.exports, require);
const { fetchRules } = mod.exports;

const checks = {};
const TOKEN = 'fake-token';
const CFG = { appToken: 'appToken', tableId: 'tblX' };

/** 假 http：把 items 包成 v1 records 响应 */
function httpOf(items) {
    return async () => ({
        status: 200,
        text: JSON.stringify({ code: 0, data: { items, has_more: false } }),
    });
}

function rec(id, fields) {
    return { record_id: id, fields };
}

(async () => {
    /* ① 标准列名：标题 / 内容 / 标签 / 排除词 / 是否常显 */
    const std = await fetchRules(
        httpOf([
            rec('r1', { 标题: '问候语', 内容: '您好，请问有什么可以帮您？', 标签: ['你好', '在吗'], 排除词: ['投诉'], 是否常显: true }),
        ]),
        TOKEN,
        CFG
    );
    checks.stdTitleOk = std[0].title === '问候语';
    checks.stdReplyOk = std[0].reply === '您好，请问有什么可以帮您？';
    checks.stdTagsOk = JSON.stringify(std[0].keywords) === JSON.stringify(['你好', '在吗']);
    checks.stdExcludesOk = JSON.stringify(std[0].excludes) === JSON.stringify(['投诉']);
    checks.stdPinnedOk = std[0].pinned === true;
    checks.stdNoFallback = std[0].titleFallback === false;

    /* ② 别名列名（隐私表实际形态）：名称 / 文本 —— 按钮必须显示名称，而不是文本 */
    const alias = await fetchRules(
        httpOf([rec('r2', { 名称: '办税服务厅地址', 文本: '湖南省长沙市……（长文本内容）' })]),
        TOKEN,
        CFG
    );
    checks.aliasTitleOk = alias[0].title === '办税服务厅地址';
    checks.aliasReplyOk = alias[0].reply === '湖南省长沙市……（长文本内容）';
    checks.aliasNoFallback = alias[0].titleFallback === false;

    /* ③ 表头带后缀：包含匹配（「标题（必填）」「内容/话术」） */
    const suffix = await fetchRules(
        httpOf([rec('r3', { '标题（必填）': '办公电话', '内容/话术': '0731-12345678' })]),
        TOKEN,
        CFG
    );
    checks.suffixTitleOk = suffix[0].title === '办公电话';
    checks.suffixReplyOk = suffix[0].reply === '0731-12345678';

    /* ④ 完全没有标题列：回退 = 内容前 12 字，且 titleFallback = true（上层据此记日志提示补列） */
    const noTitle = await fetchRules(httpOf([rec('r4', { 内容: '这是一段很长的隐私信息正文内容超过十二个字' })]), TOKEN, CFG);
    checks.fallbackTitleOk = noTitle[0].title === '这是一段很长的隐私信息正';
    checks.fallbackFlagOk = noTitle[0].titleFallback === true;

    /* ⑤ 空行丢弃 + 富文本分段数组（[{type:'text',text:'…'}]）压平 */
    const mixed = await fetchRules(
        httpOf([
            rec('r5', {}),
            rec('r6', { 标题: [{ type: 'text', text: '富文本标题' }], 内容: [{ type: 'text', text: '富文本内容' }] }),
        ]),
        TOKEN,
        CFG
    );
    checks.emptyRowDropped = mixed.length === 1;
    checks.richTextTitleOk = mixed[0].title === '富文本标题';
    checks.richTextReplyOk = mixed[0].reply === '富文本内容';

    /* ⑥ 非 0 code 必须抛错（不静默吞掉） */
    let threw = false;
    try {
        await fetchRules(
            async () => ({ status: 200, text: JSON.stringify({ code: 99991672, msg: 'no permission' }) }),
            TOKEN,
            CFG
        );
    } catch {
        threw = true;
    }
    checks.apiErrorThrowsOk = threw;

    const failed = Object.entries(checks).filter(([, v]) => !v).map(([k]) => k);
    console.log(JSON.stringify({ ok: failed.length === 0, checks, failed }, null, 1));
    process.exit(failed.length ? 1 : 0);
})();
