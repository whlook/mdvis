# mdvis

在浏览器中直接渲染本地 Markdown 文档的 Chrome 插件。打开 `.md` 文件时原页面内就地渲染，支持 emoji、mermaid、代码高亮、表格，浅色主题，全部依赖本地打包、离线可用、零网络请求。

## 安装

1. 打开 `chrome://extensions`，开启右上角「开发者模式」
2. 点击「加载已解压的扩展程序」，选择本目录（`mdvis/`）
3. **file:// 必做**：在扩展详情页打开「允许访问文件网址」（Allow access to file URLs）

## 使用

- 直接在地址栏输入本地路径：`file:///path/to/xx.md`
- 或本地起服务：`python3 -m http.server 8000`，访问 `http://localhost:8000/xx.md`

页面会就地替换为渲染结果，URL 不变，刷新即回到原文再重新渲染。

## 特性

- **emoji**：`:smile:` 等短码转为 Unicode 字符（系统 emoji 字体显示，无图片、无字体风险）
- **mermaid**：` ```mermaid ` 代码块渲染为 SVG；单个图语法错误只影响该块，显示错误提示和原始代码
- **代码高亮**：highlight.js，GitHub 浅色配色
- **字体统一**：正文系统无衬线栈（PingFang SC 等）、代码系统等宽栈（SF Mono/Menlo），全部显式声明，不加载网络字体，不继承页面残留样式——这是与其他 md 插件的关键差异
- **防误伤**：仅在 URL 以 `.md`/`.markdown` 结尾**且**页面为纯文本时渲染；GitHub 等已渲染为 HTML 的 md 页面不受影响

## 已知限制

- 个别环境下 `python http.server` 把 `.md` 识别为 `application/octet-stream` 会触发下载而非展示，这是服务器 MIME 配置问题，与插件无关（macOS 自带 Python 3 正常）
- 不监听文件变化自动刷新，手动刷新页面即可

## 目录结构

```
manifest.json      # MV3 清单
content.js         # 入口：md 纯文本页检测 → 提取文本 → 替换 body → 调渲染
renderer.js        # markdown-it/hljs/mermaid 渲染管线
styles.css         # 完整排版样式（浅色）
vendor/            # markdown-it / markdown-it-emoji / highlight.js / mermaid（本地打包）
test/sample.md     # 验证文档（emoji/mermaid/代码/表格/错误 mermaid）
test/harness.html  # 无扩展机制的本地渲染验证页
test/smoke.js      # 渲染管线 node 冒烟测试：node test/smoke.js
```

## 本地验证

```bash
cd mdvis
node test/smoke.js                  # 渲染管线冒烟测试
python3 -m http.server 8000         # 然后浏览器打开 http://localhost:8000/test/sample.md
```
