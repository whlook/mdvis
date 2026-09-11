# mdvis

在浏览器里直接查看本地 / 线上文件的小插件（Chrome MV3）：

- **Markdown**（`.md` / `.markdown`）：就地渲染，支持 emoji、mermaid、代码高亮、表格
- **YAML**（`.yaml` / `.yml`）：结构树 + 源码双视图（js-yaml 解析、highlight.js 高亮）
- **PyTorch profiler trace**（`*.pt.trace.json`、`*.pt.trace.json.gz`、`*trace*.json`）：识别后自动送进 Perfetto（ui.perfetto.dev）打开

依赖全部本地打包（`vendor/`），渲染过程零网络请求；只有打开 trace 时会连 `ui.perfetto.dev`。

## 安装

1. 打开 `chrome://extensions`，开启右上角「开发者模式」
2. 点击「加载已解压的扩展程序」，选择本目录
3. **建议开启**：扩展详情页打开「允许访问文件网址」（Allow access to file URLs）——不开启时 `file://` 页面无法自动渲染，只能靠工具栏图标 + 拖拽文件

## 使用

### Markdown

打开 `file:///path/xx.md` 或 `http://localhost:8000/xx.md` 就地渲染，URL 不变，刷新回到原文再重新渲染。

### YAML

- 打开 `file:///path/xx.yaml`（`.pt.trace.json.gz` 同理），有两条路径：
  1. **在 Chrome 目录列表 / 本地页面里点链接**（最常见）：`filelinks.js` 在点击那一刻就 `preventDefault` 接管，
     直接开查看页——**根本不会创建下载，也就不会闪下载框**
  2. 其它入口（书签、历史记录、地址栏、右键另存为）：走下载接管，`onCreated` 里立刻打开查看页并取消这次重复下载，
     不等下载完成（Chrono 这类会抢下载的扩展会先把原生下载取消掉），副本已落盘则顺手删掉
- 打开 `http(s)` 上的 yaml：用 `declarativeNetRequest` 只对主框架导航把 `content-type` 改成 `text/plain`，于是可以在原页面就地渲染
- 页面顶部两个页签：**结构树**（可折叠，`<details>`）/ **源码**（原始文本 + YAML 高亮）
- 解析用 `JSON_SCHEMA`，保持字面量：日期不会被转成 `Date`、`yes` 不会变布尔值；锚点 / 别名正常展开，循环引用有标记
- 解析失败：显示错误原因和行列号，并自动切到源码视图；节点数超过 20000 或层级过深时也退化为源码视图

### PyTorch profiler trace → Perfetto

- 打开trace json 时会自动识别（文件名 `*.pt.trace.json` / 内容里的 `"traceEvents":[` 加上 `cpu_op`、`ProfilerStep#`、`distributedInfo`、`External id` 等 PyTorch/Kineto 特征）
- 页面顶部出现提示条，同时自动打开 mdvis 查看页：fetch 字节 → `.gz` 用 `DecompressionStream` 解压 → 内嵌 Perfetto UI → `PING`/`PONG` 握手后 `postMessage` 直接加载
- 首次会弹一次 “`chrome-extension://…` is trying to open a trace file?”，选 **Always trust** 后不再询问。trace 只留在浏览器内存里，不会上传
- 本地 `*.pt.trace.json.gz` 走「下载拦截」路径（创建副本 → 删除 → 打开查看页）
- 工具栏图标随时打开查看页，也可以直接把文件拖进去；`.yaml`、`.md`、普通文本同样支持（兜底显示高亮源码）
- 查看页右上角「在 ui.perfetto.dev 打开」可在独立标签页里打开（内嵌视图异常时用）

## 已知限制

- `.json.gz` 无法在浏览器里直接打开（Chrome 只能下载），只能通过拖拽 / 工具栏图标 / 本地下载拦截进入查看页
- `http(s)` 上的 yaml 属于明确的下载意图，插件不拦截（导航到 yaml 由 DNR 就地渲染解决）；**trace 类（`*.pt.trace.json[.gz]`、`*trace*.json[.gz]`）无论本地还是远端都会接管**，Perfetto 里还能再下载原始文件
- 如果装了下载管理器类扩展（Chrono / IDM 等），它们会抢走原生下载并立刻取消；mdvis 在 `onCreated` 就接管，所以不受影响
- 对本地 yaml 用右键「链接另存为」也会被接管成查看页（文件本来就在磁盘上，不会丢；想存副本去 Finder 复制）。带 Cmd/Ctrl 的点击不拦截，保持原有新标签页行为
- 兜底源码视图对超过 32 MB 的文件跳过预览
- 不监听文件变化自动刷新，手动刷新即可

## 目录结构

```
manifest.json      # MV3 清单（content scripts / background / DNR / 权限）
dnr.json           # declarativeNetRequest 规则：主框架导航的 *.yaml 响应改写为 text/plain
detect.js          # 类型判定（纯函数）：页面类型 / 文件名类型 / trace 内容嗅探
filelinks.js       # file:// 页面（目录列表/本地 html）点击 yaml / trace 链接时直接接管，不产生下载
renderer.js        # markdown-it + hljs + mermaid + js-yaml 渲染管线（MDVisRenderer）
content.js         # content script：md / yaml 就地渲染，trace 提示条 + 自动打开查看页
background.js      # service worker：打开查看页、工具栏入口、本地文件下载拦截
viewer.html/.js    # 查看页：内嵌 Perfetto / YAML / Markdown / 源码兜底，支持拖拽
styles.css         # 浅色排版样式（markdown + YAML 结构树）
vendor/            # markdown-it / markdown-it-emoji / highlight.js / mermaid / js-yaml
```
