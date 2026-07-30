// mdvis 渲染管线 node 冒烟测试（不含 mermaid，mermaid 需要浏览器 DOM）
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const sandbox = { window: {}, console };
vm.createContext(sandbox);

for (const f of ['markdown-it.min.js', 'markdown-it-emoji.min.js', 'highlight.min.js']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'vendor', f), 'utf8'), sandbox, { filename: f });
}
// UMD 全局在 node vm 里可能挂在模块导出或 window 上，统一兜底
sandbox.window.markdownit = sandbox.window.markdownit || sandbox.markdownit;
sandbox.window.markdownitEmoji = sandbox.window.markdownitEmoji || sandbox.markdownitEmoji;
sandbox.window.hljs = sandbox.window.hljs || sandbox.hljs;

vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'renderer.js'), 'utf8'), sandbox, { filename: 'renderer.js' });

const R = sandbox.window.MDVisRenderer;
if (!R) { console.error('FAIL: MDVisRenderer 未定义'); process.exit(1); }

const md = [
  '# 标题 Title',
  '',
  '支持 emoji :smile: :rocket: 和中文混排。',
  '',
  '- 列表项一',
  '- 列表项二',
  '',
  '| 列A | 列B |',
  '| --- | --- |',
  '| 1 | 2 |',
  '',
  '```js',
  'const x = 42; // comment',
  '```',
  '',
  '```mermaid',
  'graph TD; A-->B;',
  '```',
  ''
].join('\n');

const html = R.renderMarkdown(md);

const checks = [
  ['h1 渲染', /<h1>标题 Title<\/h1>/],
  ['emoji 转 unicode', /😄/],
  ['emoji rocket', /🚀/],
  ['表格渲染', /<table>/],
  ['代码高亮 span', /hljs/],
  ['const 关键字高亮', /<span class="hljs-keyword">const<\/span>/],
  ['mermaid 保留 code block', /class="language-mermaid"/],
  ['mermaid 内容未被转义破坏', /A--&gt;B|A-->B/]
];

let ok = true;
for (const [name, re] of checks) {
  const pass = re.test(html);
  console.log((pass ? 'PASS' : 'FAIL') + ' ' + name);
  if (!pass) ok = false;
}
process.exit(ok ? 0 : 1);
