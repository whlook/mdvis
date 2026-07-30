/* mdvis renderer：markdown-it + emoji + highlight.js + mermaid。
 * 依赖 vendor 下的 UMD 全局：markdownit, markdownitEmoji, hljs, mermaid。 */
(function () {
  'use strict';

  var md = window.markdownit({
    html: false,
    linkify: true,
    breaks: false,
    highlight: function (str, lang) {
      // mermaid 代码块保持原样，后续由 mermaid 渲染成 SVG
      if (lang === 'mermaid') return '';
      if (lang && window.hljs && window.hljs.getLanguage(lang)) {
        try {
          return window.hljs.highlight(str, { language: lang }).value;
        } catch (e) { /* 高亮失败则按纯文本输出 */ }
      }
      return '';
    }
  });

  if (window.markdownitEmoji) {
    md.use(window.markdownitEmoji);
  }

  var mermaidSeq = 0;
  var mermaidReady = false;

  function ensureMermaid() {
    if (mermaidReady || !window.mermaid) return;
    window.mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      theme: 'default'
    });
    mermaidReady = true;
  }

  function cleanupMermaidLeftovers(id) {
    // mermaid 渲染失败时可能往 body 里塞错误元素，清掉
    ['#' + id, '#d' + id].forEach(function (sel) {
      var el = document.querySelector(sel);
      if (el && !document.querySelector('.mdvis-container').contains(el)) {
        el.remove();
      }
    });
  }

  window.MDVisRenderer = {
    /** markdown 文本 -> HTML 字符串（mermaid 块此时仍是 code block） */
    renderMarkdown: function (text) {
      return md.render(text);
    },

    /** 把 root 下所有 language-mermaid 代码块替换为 SVG，单块失败不影响其他内容 */
    renderMermaid: async function (root) {
      if (!window.mermaid) return;
      var blocks = root.querySelectorAll('pre code.language-mermaid');
      if (!blocks.length) return;
      ensureMermaid();

      for (var i = 0; i < blocks.length; i++) {
        var code = blocks[i];
        var pre = code.closest('pre');
        var id = 'mdvis-mmd-' + (mermaidSeq++);
        var holder = document.createElement('div');
        if (pre) {
          pre.replaceWith(holder);
        } else {
          code.replaceWith(holder);
        }
        try {
          var result = await window.mermaid.render(id, code.textContent);
          holder.className = 'mdvis-mermaid';
          holder.innerHTML = result.svg;
        } catch (e) {
          cleanupMermaidLeftovers(id);
          holder.className = 'mdvis-error';
          holder.textContent = 'Mermaid 渲染失败：' + ((e && e.message) || e);
          var orig = document.createElement('pre');
          var origCode = document.createElement('code');
          origCode.textContent = code.textContent;
          orig.appendChild(origCode);
          holder.appendChild(orig);
        }
      }
    }
  };
})();
