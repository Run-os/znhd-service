/* eslint-disable prettier/prettier */
module.exports = {
  // 显式声明根配置：否则 eslint 会继续向上级目录级联查找 .eslintrc*，
  // 一旦上级目录（例如嵌套在本仓库里的 git worktree）也有 eslint 配置，就会报
  // 「couldn't determine the plugin "@typescript-eslint" uniquely」而完全无法 lint。
  root: true,
  parser: '@typescript-eslint/parser', // 定义ESLint的解析器
  extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended', 'prettier'], //定义文件继承的子规范
  plugins: ['@typescript-eslint', 'html', 'prettier'], //定义了该eslint文件所依赖的插件
  env: {
    //指定代码的运行环境
    browser: true,
    node: true,
    es2021: true,
  },
  parserOptions: {
    //指定ESLint可以解析JSX语法
    ecmaFeatures: {
      jsx: true,
    },
    ecmaVersion: 'latest',
    sourceType: 'module',
  },
  rules: {
    // 自定义的一些规则
    // 注意：模板在这里内联了 { endOfLine: 'auto' }，那会覆盖 .prettierrc.js 的全部配置
    // （eslint-plugin-prettier 一旦收到规则选项就不再读 rc 文件），导致 tabWidth 等设置失效。
    // 本仓库把 endOfLine 放回 .prettierrc.js，这里不再传选项。
    'prettier/prettier': 'error',
    'valid-typeof': [
      'warn',
      {
        requireStringLiterals: false,
      },
    ],
    '@typescript-eslint/no-var-requires': 'off',
    // 迁移期：脚本里大量使用 any/未使用变量，先降级为警告，避免阻塞构建
    '@typescript-eslint/no-explicit-any': 'warn',
    '@typescript-eslint/no-unused-vars': 'warn',
    '@typescript-eslint/ban-ts-comment': 'off',
    'no-empty': 'warn',
  },
};
