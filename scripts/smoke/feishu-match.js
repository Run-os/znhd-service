/**
 * 飞书快捷短语「匹配引擎」纯逻辑冒烟（v26.10.26-v2 新增）。
 *
 * 为什么需要：`src/lib/feishu/match.ts` 是纯函数（零宿主依赖），用 esbuild 现场打成 CJS，
 * 几秒覆盖使用者 2026-10-26 定版的匹配顺序 —— **剔除一票否决 → 必含全部命中 → 标签任一命中**。
 *
 * 判据：所有 check 必须为 true，否则退出码 1。
 */
const esbuild = require('esbuild');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');

const built = esbuild.buildSync({
    entryPoints: [path.join(ROOT, 'src/lib/feishu/match.ts')],
    bundle: true,
    format: 'cjs',
    platform: 'node',
    write: false,
    logLevel: 'silent',
});
const mod = { exports: {} };
// eslint-disable-next-line no-new-func
new Function('module', 'exports', 'require', built.outputFiles[0].text)(mod, mod.exports, require);
const { matchRules, matchByOrgText } = mod.exports;

const checks = {};

/** 造一条规则（只填与匹配相关的字段） */
function rule(id, keywords, musts, excludes) {
    return { id: id, title: id, keywords: keywords || [], musts: musts || [], excludes: excludes || [], reply: '' };
}

/** 命中结果里的 id 列表（便于断言顺序） */
function ids(rules) {
    return rules.map((r) => r.id).join(',');
}

// ⚠️ 文本里必须出现**逐字**的「已申报」：匹配是纯子串判断，「已经申报」不含「已申报」三个连续字
//    （这条坑 AGENT.md 记过，第一版本冒烟就踩在它上面 —— 断言打红但实现是对的）
const TEXT = '你好，我是南岳区税务局的，想咨询一下解非怎么办，已申报完成';

/* ① 必含关键词多值 AND：少一个就不命中 */
const andRules = [
    rule('r-and', ['解非'], ['南岳', '税务']),
    rule('r-miss', ['解非'], ['南岳', '工商']),
];
checks.mustsAndOk = ids(matchRules(TEXT, andRules)) === 'r-and';

/* ② 必含为空 ⇒ 只看标签 */
const emptyMusts = [rule('r-tag-only', ['解非']), rule('r-no-tag-hit', ['注销'])];
checks.emptyMustsOk = ids(matchRules(TEXT, emptyMusts)) === 'r-tag-only';

/* ③ 必含通过但标签不命中 ⇒ 不显示 */
const tagMiss = [rule('r-tag-miss', ['注销'], ['南岳'])];
checks.tagMissOk = ids(matchRules(TEXT, tagMiss)) === '';

/* ④ 剔除关键词任一命中 ⇒ 即使必含 + 标签都过也不显示（一票否决） */
const excludeWins = [
    rule('r-excluded', ['解非'], ['南岳'], ['已申报']),
    rule('r-keep', ['解非'], ['南岳'], ['未申报']),
];
checks.excludeWinsOk = ids(matchRules(TEXT, excludeWins)) === 'r-keep';

/* ⑤ 无标签的规则永远不显示（哪怕必含全过） */
const noTags = [rule('r-no-tags', [], ['南岳'])];
checks.noTagsOk = ids(matchRules(TEXT, noTags)) === '';

/* ⑥ 归一化仍生效：全角 / 空格 / 大小写 */
const normRules = [
    rule('r-norm-1', ['解 非'], []), // 关键词中间有空格
    rule('r-norm-2', ['南岳区'], ['税务局']),
    rule('r-norm-3', ['EMAIL'], []), // 大小写不敏感
];
checks.normSpaceOk = ids(matchRules(TEXT, normRules)) === 'r-norm-1,r-norm-2';
checks.normCaseOk = ids(matchRules('请留下 Email 地址', normRules)) === 'r-norm-3';
checks.normFullWidthOk = ids(matchRules('请留下ＥＭＡＩＬ地址', normRules)) === 'r-norm-3';

/* ⑦ musts 缺失（旧缓存里的规则对象没有该字段）不许抛错，按「不约束」处理 */
const legacy = [{ id: 'r-legacy', title: '旧规则', keywords: ['解非'], excludes: [], reply: '' }];
let legacyThrew = false;
let legacyHit = false;
try {
    legacyHit = ids(matchRules(TEXT, legacy)) === 'r-legacy';
} catch {
    legacyThrew = true;
}
checks.legacyMustsNoThrowOk = !legacyThrew;
checks.legacyMustsHitOk = legacyHit;

/* ⑧ 空对话一律不命中（省得空文本时满屏按钮） */
checks.emptyTextOk = ids(matchRules('', andRules)) === '';

/* ⑨ 「主管税务机关」旁发送图标用的匹配（v26.10.26-v4）：必含关键词**归一化后相等**才算 */
const ORG = '国家税务总局衡阳市南岳区税务局税源管理股';
const orgRules = [
    rule('r-org-strict', [], [ORG]),
    // 万一是全称的前缀（页面上常见的短名写法）⇒ 使用者定的是「相同文本」，**不该**命中，
    // 否则同一位置会挂出另一条规则的图标
    rule('r-org-prefix', [], ['国家税务总局衡阳市南岳区税务局']),
    // 归一化仍生效：中间夹空格视为同一文本
    rule('r-org-space', [], ['国家税务总局 衡阳市南岳区税务局税源管理股']),
    // 必含为空 ⇒ 不参与
    rule('r-org-empty', [], []),
];
checks.orgStrictOk = ids(matchByOrgText(ORG, orgRules)) === 'r-org-strict,r-org-space';
checks.orgPrefixMissOk = ids(matchByOrgText(ORG, [orgRules[1]])) === '';
checks.orgEmptyInputOk = ids(matchByOrgText('', orgRules)) === '';
// 旧缓存里的规则对象没有 musts 字段 ⇒ 不许抛错，按空数组处理
checks.orgLegacyNoThrowOk = ids(matchByOrgText(ORG, [{ id: 'r-legacy2', title: 'x', keywords: [], reply: '' }])) === '';

const failed = Object.entries(checks).filter(([, v]) => !v).map(([k]) => k);
console.log(JSON.stringify({ ok: failed.length === 0, checks, failed }, null, 1));
process.exit(failed.length ? 1 : 0);
