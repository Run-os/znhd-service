/**
 * 飞书规则表「列名解析」纯逻辑冒烟（v26.10.26-v2 重写）。
 *
 * 为什么单独一套：`src/lib/feishu/rules.ts` 是零宿主依赖的纯逻辑（网络走注入的 http），
 * 用假 http 打真实代码，几秒覆盖「6 列解析 / 旧列名不认 / 无标题列回退标记 / 富文本 / 错误码」。
 *
 * 本版钉死两条（使用者 2026-10-26 定版）：
 *   ① 列名**一字不差**才算 —— `名称` / `文本` / `排除词` 这类旧写法一律当「没有该列」；
 *   ② 没有「标题」列时按钮文字回退「内容前 12 字」，且 `titleFallback = true`（上层记日志提示）。
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
    /* ① 标准 6 列：标题 / 内容 / 标签 / 剔除关键词 / 必含关键词 / 是否常显 */
    const std = await fetchRules(
        httpOf([
            rec('r1', {
                标题: '南岳区办公电话',
                内容: '0734-1234567',
                标签: ['电话', '联系'],
                剔除关键词: ['投诉'],
                必含关键词: ['南岳', '税务'],
                是否常显: true,
            }),
        ]),
        TOKEN,
        CFG
    );
    checks.stdTitleOk = std[0].title === '南岳区办公电话';
    checks.stdReplyOk = std[0].reply === '0734-1234567';
    checks.stdTagsOk = JSON.stringify(std[0].keywords) === JSON.stringify(['电话', '联系']);
    checks.stdExcludesOk = JSON.stringify(std[0].excludes) === JSON.stringify(['投诉']);
    checks.stdMustsOk = JSON.stringify(std[0].musts) === JSON.stringify(['南岳', '税务']);
    checks.stdPinnedOk = std[0].pinned === true;
    checks.stdNoFallback = std[0].titleFallback === false;

    /* ② 不认别名：只有「名称」+「文本」两列 ⇒ 标题/内容都没认出来，
          该行被当成空行丢弃（连按钮都不会有） */
    const aliasOnly = await fetchRules(
        httpOf([rec('r2', { 名称: '办税服务厅地址', 文本: '湖南省长沙市岳麓区某某路一百二十三号' })]),
        TOKEN,
        CFG
    );
    checks.aliasOnlyRowDropped = aliasOnly.length === 0;

    /* ②b 「名称」「文本」是诱饵：另有正规「内容」列时必须忽略它们 ——
          标题回退 = 内容前 12 字，且 titleFallback = true（上层据此记日志提示补「标题」列） */
    const alias = await fetchRules(
        httpOf([
            rec('r2b', {
                名称: '办税服务厅地址',
                文本: '这段是诱饵，绝不能当内容',
                内容: '湖南省长沙市岳麓区某某路一百二十三号办税服务厅',
            }),
        ]),
        TOKEN,
        CFG
    );
    checks.aliasTitleIgnored = alias[0].title === '湖南省长沙市岳麓区某某路';
    checks.aliasFallsBack = alias[0].titleFallback === true;
    checks.aliasReplyOk = alias[0].reply === '湖南省长沙市岳麓区某某路一百二十三号办税服务厅';

    /* ③ 旧列名「排除词」不生效：excludes 必须为空数组（该列被当成「没有」） */
    const legacyExclude = await fetchRules(
        httpOf([rec('r3', { 标题: '旧列名测试', 内容: '正文', 标签: ['测试'], 排除词: ['投诉'] })]),
        TOKEN,
        CFG
    );
    checks.legacyExcludeIgnored = legacyExclude[0].excludes.length === 0;
    checks.legacyExcludeTagsKept = JSON.stringify(legacyExclude[0].keywords) === JSON.stringify(['测试']);

    /* ④ 旧列名「标题（必填）」「内容/话术」同样不认 ⇒ 两者都空 ⇒ 整行丢弃 */
    const suffix = await fetchRules(
        httpOf([rec('r4', { '标题（必填）': '办公电话', '内容/话术': '0731-12345678' })]),
        TOKEN,
        CFG
    );
    checks.suffixColsDropped = suffix.length === 0;

    /* ⑤ 完全没有标题列：回退 = 内容前 12 字，且 titleFallback = true（上层据此记日志提示补列） */
    const noTitle = await fetchRules(httpOf([rec('r5', { 内容: '这是一段很长的隐私信息正文内容超过十二个字' })]), TOKEN, CFG);
    checks.fallbackTitleOk = noTitle[0].title === '这是一段很长的隐私信息正';
    checks.fallbackFlagOk = noTitle[0].titleFallback === true;

    /* ⑥ 空行丢弃 + 富文本分段数组（[{type:'text',text:'…'}]）压平 */
    const mixed = await fetchRules(
        httpOf([
            rec('r6', {}),
            rec('r7', { 标题: [{ type: 'text', text: '富文本标题' }], 内容: [{ type: 'text', text: '富文本内容' }] }),
            rec('r8', { 标题: '多选必含', 内容: '正文', 必含关键词: ['南岳', '税务'] }),
        ]),
        TOKEN,
        CFG
    );
    checks.emptyRowDropped = mixed.length === 2;
    checks.richTextTitleOk = mixed[0].title === '富文本标题';
    checks.richTextReplyOk = mixed[0].reply === '富文本内容';
    checks.multiSelectMustsOk = JSON.stringify(mixed[1].musts) === JSON.stringify(['南岳', '税务']);
    checks.emptyMustsOk = JSON.stringify(mixed[0].musts) === JSON.stringify([]);

    /* ⑦ 非 0 code 必须抛错（不静默吞掉） */
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
