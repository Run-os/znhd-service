/**
 * 飞书「搜索多维表格」纯逻辑冒烟（v26.10.24-v6，v26.10.25-v1 起断言大写 BITABLE）。
 *
 * 为什么单独一套：`src/lib/feishu/search.ts` 是**零宿主依赖的纯逻辑**（网络通过注入的
 * `http` 函数），不需要启动 Puppeteer、不需要真机、不碰飞书线上环境。用假 http 打真实
 * 代码，几秒内就能覆盖「请求体形态 / 关键词截断 / 高亮清理 / 分页 / 错误码文案」。
 * ⚠️ mock 响应里的 `doc_types: ['bitable']` 是**响应解析**侧：飞书实际返回什么就吃什么，
 *    与请求体里的大写 `BITABLE`（枚举硬约束）无关，两处不一致是刻意的。
 *
 * 用 esbuild 现场把 TS 打成 CJS（esbuild 是 vite 的依赖，不额外引入）——
 * 不写临时文件，避免 outputs/ 里多一堆垃圾。
 *
 * 判据：所有 check 必须为 true，否则退出码 1。
 */
const esbuild = require('esbuild');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');

const built = esbuild.buildSync({
    entryPoints: [path.join(ROOT, 'src/lib/feishu/search.ts')],
    bundle: true,
    format: 'cjs',
    platform: 'node',
    write: false,
    logLevel: 'silent',
});
const mod = { exports: {} };
// eslint-disable-next-line no-new-func
new Function('module', 'exports', 'require', built.outputFiles[0].text)(mod, mod.exports, require);
const { searchBitableDocs, searchErrorText, SEARCH_SCOPE } = mod.exports;

const checks = {};

/** 假 http：记录请求，返回固定响应 */
function mockHttp(response) {
    const calls = [];
    const fn = async (opts) => {
        calls.push(opts);
        return response;
    };
    fn.calls = calls;
    return fn;
}

/** 包一层：抓到抛出的错误消息（不 throw 出来的话等于这个用例没测到） */
async function catchMessage(fn) {
    try {
        await fn();
        return null;
    } catch (e) {
        return (e && e.message) || String(e);
    }
}

function okPage(units, extra) {
    return {
        status: 200,
        text: JSON.stringify({
            code: 0,
            msg: 'success',
            data: Object.assign({ res_units: units, has_more: false }, extra || {}),
        }),
    };
}

(async () => {
    // ---------- 1. 正常结果解析 ----------
    const http = mockHttp(
        okPage(
            [
                {
                    title: '规则表',
                    entity_type: 'doc',
                    result_meta: {
                        doc_types: ['bitable'],
                        url: 'https://x.feishu.cn/base/bascn1?table=tbl1',
                        update_time_iso: '2026-10-20T10:00:00+08:00',
                    },
                },
                {
                    // 搜索命中时飞书给的是带 <hb> 高亮标签的标题
                    title_highlighted: '快捷<hb>回复</hb>表',
                    entity_type: 'wiki',
                    result_meta: { doc_types: ['bitable'], url: 'https://x.feishu.cn/wiki/wikcn1' },
                },
                // 没有 url 的结果无法回填到设置面板，必须丢弃
                { title: '没链接的', result_meta: {} },
            ],
            { page_token: 'pt2', has_more: true }
        )
    );
    const page = await searchBitableDocs(http, 'TOKEN', '');
    const body = JSON.parse(http.calls[0].body);

    checks.urlOk = http.calls[0].url.indexOf('/open-apis/search/v2/doc_wiki/search') >= 0;
    checks.methodOk = http.calls[0].method === 'POST';
    checks.authOk = http.calls[0].headers.Authorization === 'Bearer TOKEN';
    // 云空间与知识库各自一份 filter：只给一边会漏掉知识库里的表
    // 断言必须写成容错形式：实现把 wiki_filter 整个漏掉时，要记 false 而不是抛 TypeError
    const df = body.doc_filter || {};
    const wf = body.wiki_filter || {};
    checks.docFilterOk = Array.isArray(df.doc_types) && df.doc_types.length === 1 && df.doc_types[0] === 'BITABLE';
    checks.wikiFilterOk = Array.isArray(wf.doc_types) && wf.doc_types[0] === 'BITABLE';
    checks.pageSizeOk = body.page_size === 15;
    checks.emptyQueryOk = body.query === '';
    checks.firstPageNoToken = !('page_token' in body);

    checks.itemsOk = page.items.length === 2;
    checks.titleOk = page.items[0].title === '规则表';
    checks.highlightStrippedOk = page.items[1].title === '快捷回复表';
    checks.typeOk = page.items[0].type === 'bitable';
    checks.timeOk = page.items[0].editedAt === Date.parse('2026-10-20T10:00:00+08:00');
    checks.unknownTimeOk = page.items[1].editedAt === 0;
    checks.pagingOk = page.pageToken === 'pt2' && page.hasMore === true;

    // ---------- 2. 关键词按码点截断到 30 ----------
    const http2 = mockHttp(okPage([]));
    const longQuery = 'a'.repeat(29) + '😀' + 'b'; // 31 个码点，第 30 个是代理对
    await searchBitableDocs(http2, 'T', longQuery);
    const q2 = JSON.parse(http2.calls[0].body).query;
    // 用 Array.from 数才是码点数；服务端按码点判 30
    checks.queryTruncatedOk = Array.from(q2).length === 30;
    // 截断不能把 emoji 切成半个（slice(0,30) 会切坏，UTF-16 长度会是 31）
    checks.surrogateIntactOk = q2.endsWith('😀') && !q2.includes('b');

    // ---------- 3. 翻页游标透传 ----------
    const http3 = mockHttp(okPage([]));
    await searchBitableDocs(http3, 'T', '规则', 'pt2');
    const b3 = JSON.parse(http3.calls[0].body);
    checks.pageTokenOk = b3.page_token === 'pt2' && b3.query === '规则';

    // ---------- 4. 错误码文案 ----------
    const scopeMsg = await catchMessage(() =>
        searchBitableDocs(mockHttp({ status: 403, text: JSON.stringify({ code: 99991672, msg: 'app_scope_not_applied' }) }), 'T', '')
    );
    // 审计合并：原来单列的 scopeTextOk 只测了「同分支另一个码值」，这里并进同一条
    checks.scopeErrorOk =
        !!scopeMsg &&
        scopeMsg.indexOf('重新授权') >= 0 &&
        // 99991679 也是 SCOPE_CODES 成员，必须走同一段文案（防止只映射了一个码）
        searchErrorText(99991679, '').indexOf('重新授权') >= 0;

    const paramMsg = await catchMessage(() =>
        searchBitableDocs(mockHttp({ status: 400, text: JSON.stringify({ code: 99992402, msg: 'field validation failed' }) }), 'T', '')
    );
    // v26.10.25-v1：99992402 是泛化「参数不合法」（doc_types 大小写错、query 超长都触发），
    // 文案不得再断言「关键词太长」；必须保留码值与「参数不合法」提示。
    // 审计合并：原来单列的 paramTextOk（直调 searchErrorText）已被下面这几条完全覆盖 ——
    // 抛出的 message 就是 searchErrorText(code, msg) 的返回值，服务端 msg 透传也在这里断。
    checks.paramErrorOk =
        !!paramMsg &&
        paramMsg.indexOf('99992402') >= 0 &&
        paramMsg.indexOf('参数不合法') >= 0 &&
        paramMsg.indexOf('关键词太长') < 0 &&
        paramMsg.indexOf('field validation failed') >= 0;

    // 非 JSON / 缺 code：都必须抛错，不能当「空列表」静默吞掉
    const htmlMsg = await catchMessage(() =>
        searchBitableDocs(mockHttp({ status: 502, text: '<html>bad gateway</html>' }), 'T', '')
    );
    checks.nonJsonErrorOk = !!htmlMsg && htmlMsg.indexOf('非 JSON') >= 0;

    const noCodeMsg = await catchMessage(() =>
        searchBitableDocs(mockHttp({ status: 200, text: JSON.stringify({ data: { res_units: [] } }) }), 'T', '')
    );
    checks.missingCodeErrorOk = !!noCodeMsg && noCodeMsg.indexOf('code') >= 0;

    // 未知错误码也要带上码值，否则线上只能看到「搜索失败」
    checks.unknownCodeTextOk = searchErrorText(123, 'oops').indexOf('123') >= 0;
    // scope 常量必须与 oauth.ts 申请的那一项一致（拼错会导致永远判定为「没权限」）
    checks.scopeConstOk = SEARCH_SCOPE === 'search:docs:read';

    const failed = Object.keys(checks).filter((k) => !checks[k]);
    console.log(JSON.stringify({ checks, failed }, null, 2));
    if (failed.length) {
        console.error('\nFAILED: ' + failed.join(', '));
        process.exit(1);
    }
    console.log('\nfeishu-search:ALL-OK (' + Object.keys(checks).length + ' checks)');
})().catch((e) => {
    console.error(e);
    process.exit(1);
});
