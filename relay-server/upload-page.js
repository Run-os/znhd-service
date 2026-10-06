/**
 * 手机上传页（同源托管）。
 *
 * v26.10.06-v3 起整页改为 **React 19 + Ant Design v6** 应用，源码在仓库根的 `web/`，
 * 由 Vite 构建到 `relay-server/public/`（产物提交进仓库）。本模块只负责：
 *   · 启动时把 `public/index.html` 读进内存（GET /u/<deviceId> 直接吐出去）；
 *   · 构建产物缺失时给一个可读的兜底页，而不是 500。
 * 静态资源（/assets/*）由 server.js 直接托管 —— 运行时不装依赖、不构建。
 *
 * ⚠️ 改了 web/ 下的代码后必须 `npm run build:web`（或 `npm run build`）重新产出 public/，
 *    CI 有产物漂移检查（见 .github/workflows/webpack.yml）。
 */

const fs = require('fs');
const path = require('path');

const PUBLIC_DIR = path.join(__dirname, 'public');

/** 构建产物 HTML（启动时读一次；部署是「重启容器」，改完重启即生效） */
const INDEX_HTML = (() => {
    try {
        return fs.readFileSync(path.join(PUBLIC_DIR, 'index.html'), 'utf8');
    } catch (e) {
        return '';
    }
})();

/** 产物缺失时的兜底页：说明原因，避免只看到空白/500 */
function fallbackHtml() {
    return (
        '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">' +
        '<meta name="viewport" content="width=device-width,initial-scale=1"><title>页面未构建</title></head>' +
        "<body style=\"font:14px -apple-system,BlinkMacSystemFont,'PingFang SC',sans-serif;padding:24px;line-height:1.7\">" +
        '<h3 style="color:#e4393c;margin:0 0 8px">页面资源未生成</h3>' +
        '<p>中继服务找不到 <code>relay-server/public/index.html</code>。</p>' +
        '<p>请在仓库根执行 <code>npm run build:web</code>（或 <code>npm run build</code>）后重新部署。</p>' +
        '</body></html>'
    );
}

function uploadPageHtml() {
    return INDEX_HTML || fallbackHtml();
}

module.exports = { uploadPageHtml, PUBLIC_DIR };
