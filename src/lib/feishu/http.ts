/**
 * 飞书 API 的 HTTP 适配层（唯一允许出现 `GM_xmlhttpRequest` 的地方之一）。
 *
 * 为什么要有这一层：`oauth.ts` / `rules.ts` 是纯逻辑，冒烟测试页（普通浏览器页面、
 * 无沙箱）可以直接把它们跑起来；真机上的跨域由脚本管理器的特权请求负责。
 * 因此所有网络访问都以「函数注入」的形式传进逻辑层 —— 逻辑层不 import 任何 GM_* 全局。
 *
 * ⚠️ 飞书端点必须在 @connect 白名单里（见 config/common.meta.json）：本项目当前是 `*`，
 *    新增域名无需改动；若将来收紧，需补 `accounts.feishu.cn` 与 `open.feishu.cn`。
 */

export interface HttpRequestOptions {
    method: 'GET' | 'POST';
    url: string;
    /** 请求头（表单提交务必带 Content-Type: application/x-www-form-urlencoded） */
    headers?: Record<string, string>;
    /** 请求体，表单已序列化好的字符串 */
    body?: string;
    /** 超时毫秒，默认 20s */
    timeout?: number;
}

export interface HttpResponse {
    status: number;
    text: string;
}

export type HttpFn = (opts: HttpRequestOptions) => Promise<HttpResponse>;

/**
 * 脚本管理器特权请求实现。
 *
 * 用 GM_xmlhttpRequest 而不是 fetch：油猴沙箱里的 fetch 仍受同源策略约束，
 * 而飞书 API 与我们注入的税务页不同源。
 *
 * 注意 onerror 的语义：它只在**网络层**失败（DNS/断开/被拦截）时触发；
 * HTTP 4xx/5xx 走 onload，由调用方按 status 判断 —— 飞书的 OAuth 错误体
 * （authorization_pending / slow_down）正是 4xx，不能在这里当异常抛掉。
 */
export const gmHttp: HttpFn = (opts) =>
    new Promise<HttpResponse>((resolve, reject) => {
        GM_xmlhttpRequest({
            method: opts.method,
            url: opts.url,
            headers: opts.headers,
            data: opts.body,
            timeout: opts.timeout ?? 20000,
            onload: (res) => resolve({ status: res.status, text: res.responseText }),
            onerror: () => reject(new Error('网络请求失败：' + opts.url)),
            ontimeout: () => reject(new Error('网络请求超时：' + opts.url)),
        });
    });

/**
 * 解析响应为 JSON 对象；解析失败返回 null（由调用方按「非预期响应」处理）。
 * 刻意不抛异常：飞书在极端情况下会返回 HTML 错误页，抛出去会打断整条轮询。
 */
export function parseJson(text: string): Record<string, unknown> | null {
    try {
        const v = JSON.parse(text);
        return v && typeof v === 'object' ? (v as Record<string, unknown>) : null;
    } catch {
        return null;
    }
}

/** 表单序列化（OAuth 端点一律 x-www-form-urlencoded） */
export function formEncode(fields: Record<string, string>): string {
    return Object.keys(fields)
        .map((k) => encodeURIComponent(k) + '=' + encodeURIComponent(fields[k]))
        .join('&');
}

/** 从响应对象里安全取字符串字段 */
export function str(o: Record<string, unknown> | null, key: string): string {
    const v = o ? o[key] : undefined;
    return typeof v === 'string' ? v : '';
}

/** 从响应对象里安全取数字字段（字符串数字也接受） */
export function num(o: Record<string, unknown> | null, key: string): number {
    const v = o ? o[key] : undefined;
    const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
    return Number.isFinite(n) ? n : 0;
}
