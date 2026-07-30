/* mdvis content script：检测 md 纯文本页 → 提取原文 → 整页替换为渲染结果。 */
(function () {
  'use strict';

  // 防重复执行
  if (document.documentElement.classList.contains('mdvis-rendered')) return;

  // 1. URL 必须以 .md / .markdown 结尾
  var path = '';
  try {
    path = decodeURIComponent(location.pathname);
  } catch (e) {
    path = location.pathname;
  }
  if (!/\.(md|markdown)$/i.test(path)) return;

  // 2. 页面必须是纯文本（避免破坏 GitHub 等已渲染成 HTML 的 md 页面）
  function looksLikePlainText() {
    var ct = document.contentType || '';
    if (ct && ct.indexOf('html') === -1) return true; // text/plain、text/markdown 等
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

  var rawText = '';

  function fileName() {
    var seg = path.split('/').pop();
    return seg || 'markdown';
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

  async function main() {
    try {
      if (!window.MDVisRenderer) throw new Error('renderer 未加载');

      rawText = await getSourceText();
      if (!rawText.trim()) return;

      var html = window.MDVisRenderer.renderMarkdown(rawText);

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

      await window.MDVisRenderer.renderMermaid(container);
    } catch (err) {
      renderFallback(err);
    }
  }

  main();
})();
