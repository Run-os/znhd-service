/**
 * 常用语抽屉（原 app.ts 的 CommonPhrasesDrawer）。
 * 模块化 P5：逐字迁移，仅加 export。
 */

import { DEFAULTS } from '@/lib/constants';
import { addLog } from '@/lib/logger';
import { resolveGithubUrl, safeDecodeURIComponent } from '@/lib/utils';
import { appendToTinyMCE } from '@/lib/tinymce';
import { safeCopyText } from '@/lib/clipboard';

/** CommonPhrasesDrawer 组件属性 */
export interface CommonPhrasesDrawerProps {
    visible: boolean;
    setVisible: (v: boolean) => void;
    phrasesData: Record<string, string>;
    setPhrasesData: (data: Record<string, string>) => void;
    phrasesLoading: boolean;
    setPhrasesLoading: (v: boolean) => void;
    searchKeyword: string;
    setSearchKeyword: (v: string) => void;
    loadPhrasesData: (force?: boolean) => void;
    commonPhrasesUrl: string;
}

export function CommonPhrasesDrawer({
    visible,
    setVisible,
    phrasesData,
    setPhrasesData,
    phrasesLoading,
    setPhrasesLoading,
    searchKeyword,
    setSearchKeyword,
    loadPhrasesData,
    commonPhrasesUrl,
}: CommonPhrasesDrawerProps) {
    return CAT_UI.Drawer(
        CAT_UI.createElement('div', { style: { textAlign: 'left' } }, [
            // 显示当前数据源
            CAT_UI.createElement(
                'div',
                {
                    style: {
                        marginBottom: '16px',
                        color: '#666',
                        fontSize: '12px',
                        wordBreak: 'break-all',
                    },
                },
                `数据源: ${safeDecodeURIComponent(resolveGithubUrl(commonPhrasesUrl || DEFAULTS.commonPhrasesUrl))}`
            ),
            // 重新加载按钮
            CAT_UI.Button('重新加载常用语', {
                type: 'primary',
                loading: phrasesLoading,
                onClick: () => loadPhrasesData(true),
                style: { marginBottom: '16px', width: '100%' },
            }),
            // 搜索框（onChange 与兄弟输入框同款解包：兼容 CAT_UI 回传字符串或事件对象两种形态）
            CAT_UI.Input({
                placeholder: '搜索常用语(按键名称或内容)',
                value: searchKeyword,
                onChange: (val: any) => {
                    setSearchKeyword(typeof val === 'string' ? val : val && val.target ? val.target.value : '');
                },
                allowClear: true,
                style: { marginBottom: '16px', width: '100%' },
            }),
            // 动态生成常用语按钮
            phrasesLoading
                ? CAT_UI.createElement('div', { style: { textAlign: 'center', padding: '20px' } }, '加载中...')
                : Object.keys(phrasesData).length === 0
                ? CAT_UI.createElement(
                      'div',
                      { style: { textAlign: 'center', padding: '20px', color: '#999' } },
                      '暂无常用语数据，请点击上方按钮加载'
                  )
                : (() => {
                      // 根据搜索关键字过滤常用语
                      const keyword = searchKeyword.trim().toLowerCase();
                      const filteredEntries = keyword
                          ? Object.entries(phrasesData).filter(
                                ([key, value]) =>
                                    String(key).toLowerCase().includes(keyword) ||
                                    String(value).toLowerCase().includes(keyword)
                            )
                          : Object.entries(phrasesData);

                      return filteredEntries.length === 0
                          ? CAT_UI.createElement(
                                'div',
                                { style: { textAlign: 'center', padding: '20px', color: '#999' } },
                                '没有匹配的常用语'
                            )
                          : CAT_UI.Space(
                                filteredEntries.map(([key, value]) =>
                                    CAT_UI.Button(key, {
                                        key: key, // React 列表 key（缺省会告警，且重排时复用错节点）
                                        type: 'default',
                                        onClick() {
                                            safeCopyText(value);
                                            setVisible(false);
                                            appendToTinyMCE(value);
                                            addLog(`添加文本: ${value}`, 'success');
                                            CAT_UI.Message.success('添加文本: ' + value);
                                        },
                                        style: { marginBottom: '8px', width: '100%' },
                                    })
                                ),
                                { direction: 'vertical', style: { width: '100%' } }
                            );
                  })(),
            CAT_UI.Divider(''),
        ]),
        {
            title: '常用语',
            visible,
            width: 400,
            focusLock: true,
            autoFocus: false,
            zIndex: 10001,
            onOk: () => {
                setVisible(false);
            },
            onCancel: () => {
                setVisible(false);
            },
        }
    );
}
