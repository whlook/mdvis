/* mdvis content script：检测纯文本页 → 按类型处理。
 *  - md / markdown → 就地渲染文档
 *  - yaml / yml    → 就地渲染（结构树 + 源码）
 *  - trace json    → 顶部提示条 + 自动在 Perfetto（ui.perfetto.dev）中打开
 * 只接管纯文本页，GitHub 等已渲染成 HTML 的页面不受影响。 */
(function () {
  'use strict';

  // 防重复执行
  if (document.documentElement.classList.contains('mdvis-rendered')) return;

  var D = window.MDVisDetect;
  if (!D) return;

  // 1. URL 路径决定页面类型
  var path = '';
  try {
    path = decodeURIComponent(location.pathname);
  } catch (e) {
    path = location.pathname;
  }
  var kind = D.docKind(path, document.contentType);
  if (!kind) return;

  // 2. 页面必须是纯文本（避免破坏 GitHub 等已渲染成 HTML 的 md 页面）
  function looksLikePlainText() {
    var ct = document.contentType || '';
    if (ct && ct.indexOf('html') === -1) return true; // text/plain、text/markdown、application/json 等
    var body = document.body;
    if (!body) return false;
    var els = Array.prototype.filter.call(body.children, function (el) {
      return el.tagName !== 'SCRIPT' && el.tagName !== 'STYLE';
    });
    return els.every(function (el) { return el.tagName === 'PRE'; });
  }
  if (!looksLikePlainText()) return;

  // http(s) 下服务器常不返回 charset，Chrome 会按本地默认编码（如 GBK）误解码
  // UTF-8 字节，导致 innerText 已是乱码。因此改为 fetch 原始字节自行解码；
  // file:// 下 Chrome 按 UTF-8 解码正常（且 file 源无法 fetch），直接用 innerText。
  async function getSourceText() {
    if (location.protocol === 'file:') {
      return document.body ? document.body.innerText : '';
    }
    try {
      var buf = await (await fetch(location.href)).arrayBuffer();
      try {
        return new TextDecoder('utf-8', { fatal: true }).decode(buf);
      } catch (e) {
        return new TextDecoder('gbk').decode(buf); // 兼容 GBK 编码的旧文档
      }
    } catch (e) {
      return document.body ? document.body.innerText : '';
    }
  }

  // 大文件只取头部若干字符（trace 嗅探够了），避免为几百 MB 的 json 复制整份文本
  function headText(limit) {
    if (!document.body) return '';
    var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    var parts = [];
    var total = 0;
    var node;
    while (total < limit && (node = walker.nextNode())) {
      var text = node.nodeValue;
      if (!text) continue;
      var take = Math.min(text.length, limit - total);
      parts.push(take === text.length ? text : text.slice(0, take));
      total += take;
    }
    return parts.join('');
  }

  var rawText = '';

  function fileName() {
    var seg = path.split('/').pop();
    return seg || 'document';
  }

  function renderFallback(err) {
    // 渲染管线出错：回退为等宽原文 + 顶部错误提示，不白屏
    document.documentElement.classList.add('mdvis-rendered');
    var banner = document.createElement('div');
    banner.style.cssText =
      'padding:10px 14px;margin:12px auto;max-width:880px;border:1px solid #f0c6cb;' +
      'border-radius:6px;background:#ffebe9;color:#82071e;' +
      'font:14px -apple-system,"PingFang SC",sans-serif;';
    banner.textContent = 'mdvis 渲染失败，已显示原文：' + ((err && err.message) || err);
    var pre = document.createElement('pre');
    pre.style.cssText =
      'max-width:880px;margin:12px auto;padding:16px;white-space:pre-wrap;' +
      'font:13px ui-monospace,Menlo,Consolas,monospace;';
    pre.textContent = rawText;
    document.body.innerHTML = '';
    document.body.appendChild(banner);
    document.body.appendChild(pre);
  }

  /* ---------- trace json：交给 Perfetto ---------- */

  function askOpenViewer(force) {
    // 由 background 用 chrome.tabs.create 打开 viewer 页（content script 无法直接跳转扩展页）
    if (!window.chrome || !chrome.runtime || !chrome.runtime.sendMessage) return false;
    try {
      chrome.runtime.sendMessage({ type: 'mdvis:openViewer', src: location.href, force: !!force }, function () {
        void chrome.runtime.lastError; // background 未响应/已休眠时不报错
      });
      return true;
    } catch (e) {
      return false;
    }
  }

  function showTraceBar(traceKind) {
    if (document.getElementById('mdvis-tracebar')) return;
    var bar = document.createElement('div');
    bar.id = 'mdvis-tracebar';
    bar.style.cssText =
      'position:fixed;z-index:2147483647;top:12px;left:50%;transform:translateX(-50%);' +
      'display:flex;align-items:center;gap:10px;padding:8px 12px;border-radius:999px;' +
      'background:#1f2328;color:#fff;box-shadow:0 4px 16px rgba(0,0,0,.25);' +
      'font:13px -apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif;';
    var text = document.createElement('span');
    text.textContent = 'mdvis 识别到 ' + D.label(traceKind);
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = '在 Perfetto 中打开';
    btn.style.cssText =
      'padding:4px 10px;border:0;border-radius:999px;background:#0969da;color:#fff;' +
      'font:inherit;cursor:pointer;';
    btn.addEventListener('click', function () {
      if (!askOpenViewer(true)) {
        // 拿不到扩展 API 时退化为新标签页
        window.open('https://ui.perfetto.dev/', '_blank');
      }
      btn.disabled = true;
      btn.textContent = '已发起打开…';
      setTimeout(function () {
        btn.disabled = false;
        btn.textContent = '在 Perfetto 中打开';
      }, 3000);
    });
    bar.appendChild(text);
    bar.appendChild(btn);
    document.body.appendChild(bar);
  }

  function handleTracePage() {
    var traceKind = D.traceKind(headText(D.SNIFF_LIMIT), fileName());
    if (!traceKind) return; // 普通 json 页面不干预
    showTraceBar(traceKind);
    // 直接打开一次性给出 Perfetto 视图；失败（如扩展上下文失效）时仍可用提示条
    askOpenViewer();
  }

  /* ---------- markdown / yaml：整页替换 ---------- */

  async function main() {
    try {
      if (kind === 'json') {
        handleTracePage();
        return;
      }
      if (!window.MDVisRenderer) throw new Error('renderer 未加载');

      rawText = await getSourceText();
      if (!rawText.trim()) return;

      var isYaml = kind === 'yaml';
      var html = isYaml
        ? window.MDVisRenderer.renderYaml(rawText)
        : window.MDVisRenderer.renderMarkdown(rawText);

      // 注入插件样式（web_accessible_resources 已声明 styles.css）
      var css = '';
      try {
        css = await (await fetch(chrome.runtime.getURL('styles.css'))).text();
      } catch (e) { /* 样式加载失败时仍渲染结构 */ }

      document.head.innerHTML = '';
      var meta = document.createElement('meta');
      meta.setAttribute('charset', 'utf-8');
      document.head.appendChild(meta);
      if (css) {
        var style = document.createElement('style');
        style.textContent = css;
        document.head.appendChild(style);
      }

      document.title = fileName();
      document.documentElement.classList.add('mdvis-rendered');

      var container = document.createElement('div');
      container.className = 'mdvis-container';
      container.innerHTML = html;
      document.body.innerHTML = '';
      document.body.appendChild(container);

      if (isYaml) {
        window.MDVisRenderer.initYaml(container);
      } else {
        await window.MDVisRenderer.renderMermaid(container);
      }
    } catch (err) {
      renderFallback(err);
    }
  }

  main();
})();
