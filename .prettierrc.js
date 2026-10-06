module.exports = {
  printWidth: 120, //一行的字符数，如果超过会进行换行，默认为80
  // 模板为 2；本仓库既有脚本是 4 空格缩进，为保持全仓风格一致、避免格式化产生海量无关 diff，沿用 4
  tabWidth: 4,
  endOfLine: 'auto',
  useTabs: false, //是否使用tab进行缩进，默认为false，表示用空格进行缩减
  singleQuote: true, //字符串是否使用单引号，默认为false，使用双引号
  semi: true, //行位是否使用分号，默认为true
  trailingComma: 'es5', //是否使用尾逗号，有三个可选值"<none|es5|all>"
  bracketSpacing: true, //对象大括号直接是否有空格，默认为true
  arrowParens: 'always', // 箭头函数单个参数加分号
  bracketSameLine: true,
};
