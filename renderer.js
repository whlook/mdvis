/* mdvis renderer：markdown-it + emoji + highlight.js + mermaid + js-yaml。
 * 依赖 vendor 下的 UMD 全局：markdownit, markdownitEmoji, hljs, mermaid, jsyaml。 */
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

  /* ---------- YAML ---------- */

  var YAML_MAX_NODES = 20000; // 超过则不给结构树，只给源码，避免大配置把页面卡死
  var YAML_MAX_DEPTH = 64;

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function isContainer(v) {
    return v !== null && typeof v === 'object';
  }

  function countNodes(value, budget, seen) {
    if (budget.n > YAML_MAX_NODES) return;
    budget.n++;
    if (!isContainer(value) || seen.has(value)) return;
    seen.add(value);
    if (Array.isArray(value)) {
      for (var i = 0; i < value.length; i++) countNodes(value[i], budget, seen);
    } else {
      for (var k in value) {
        if (Object.prototype.hasOwnProperty.call(value, k)) countNodes(value[k], budget, seen);
      }
    }
    seen.delete(value);
  }

  function scalarHtml(v) {
    if (v === null) return '<span class="mdvis-yv mdvis-yv-null">null</span>';
    if (typeof v === 'boolean') return '<span class="mdvis-yv mdvis-yv-bool">' + (v ? 'true' : 'false') + '</span>';
    if (typeof v === 'number') return '<span class="mdvis-yv mdvis-yv-num">' + esc(String(v)) + '</span>';
    var s = typeof v === 'string' ? v : String(v);
    if (s === '') return '<span class="mdvis-yv mdvis-yv-str mdvis-yv-empty">""</span>';
    var block = /\n/.test(s);
    return '<span class="mdvis-yv mdvis-yv-str' + (block ? ' mdvis-yv-block' : '') + '">' + esc(s) + '</span>';
  }

  function yamlLeaf(keyHtml, value) {
    return '<div class="mdvis-yaml-leaf">' + keyHtml +
      (keyHtml ? '<span class="mdvis-yaml-colon">:</span> ' : '') + scalarHtml(value) + '</div>';
  }

  function yamlNode(keyHtml, value, depth, seen) {
    var isArr = Array.isArray(value);
    var keys = isArr ? value.map(function (_, i) { return String(i); }) : Object.keys(value);
    var badge = isArr ? '[' + keys.length + ']' : '{' + keys.length + '}';
    var out = '<details class="mdvis-yaml-node"' + (depth < 2 ? ' open' : '') + '>' +
      '<summary>' + keyHtml + '<span class="mdvis-yaml-count">' + badge + '</span></summary>' +
      '<div class="mdvis-yaml-children">';
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      var childKey = '<span class="mdvis-yk' + (isArr ? ' mdvis-yk-index' : '') + '">' + esc(k) + '</span>';
      out += yamlAny(childKey, isArr ? value[i] : value[k], depth + 1, seen);
    }
    return out + '</div></details>';
  }

  function yamlAny(keyHtml, value, depth, seen) {
    if (!isContainer(value)) return yamlLeaf(keyHtml, value);
    if (seen.has(value)) {
      return '<div class="mdvis-yaml-leaf">' + keyHtml +
        (keyHtml ? '<span class="mdvis-yaml-colon">:</span> ' : '') +
        '<span class="mdvis-yaml-cycle">↻ 循环引用</span></div>';
    }
    if (depth >= YAML_MAX_DEPTH) {
      return '<div class="mdvis-yaml-leaf">' + keyHtml +
        (keyHtml ? '<span class="mdvis-yaml-colon">:</span> ' : '') +
        '<span class="mdvis-yaml-cycle">… 层级过深</span></div>';
    }
    seen.add(value);
    var html = yamlNode(keyHtml, value, depth, seen);
    seen.delete(value);
    return html;
  }

  function yamlSourceHtml(text) {
    var body;
    if (window.hljs && window.hljs.getLanguage('yaml')) {
      try {
        body = window.hljs.highlight(text, { language: 'yaml' }).value;
      } catch (e) { /* 高亮失败按纯文本 */ }
    }
    if (body === undefined) body = esc(text);
    return '<pre class="mdvis-yaml-source"><code class="hljs language-yaml">' + body + '</code></pre>';
  }

  function yamlDocs(text) {
    if (!window.jsyaml) throw new Error('js-yaml 未加载');
    // JSON_SCHEMA：保持字面量（不把 2024-01-01 变成 Date、yes 变成 bool），所见即所得
    return window.jsyaml.loadAll(text, { schema: window.jsyaml.JSON_SCHEMA, json: true });
  }

  function renderYaml(text) {
    var docs;
    try {
      docs = yamlDocs(text);
    } catch (e) {
      var mark = (e && e.mark) || {};
      var where = mark.line !== undefined
        ? '（第 ' + (mark.line + 1) + ' 行第 ' + (mark.column + 1) + ' 列）'
        : '';
      var reason = String((e && e.reason) || (e && e.message) || e);
      return '<div class="mdvis-yaml">' +
        '<div class="mdvis-error">YAML 解析失败：' + esc(reason) + esc(where) + '，已显示源码视图。</div>' +
        yamlSourceHtml(text) +
        '</div>';
    }

    var budget = { n: 0 };
    for (var d = 0; d < docs.length; d++) countNodes(docs[d], budget, new Set());
    if (budget.n > YAML_MAX_NODES) {
      return '<div class="mdvis-yaml">' +
        '<div class="mdvis-error">文档过大（节点数超过 ' + YAML_MAX_NODES + '），已显示源码视图。</div>' +
        yamlSourceHtml(text) +
        '</div>';
    }

    var tree = '';
    var multi = docs.length > 1;
    for (var i = 0; i < docs.length; i++) {
      var doc = docs[i];
      var inner;
      if (doc === undefined) {
        inner = '<div class="mdvis-yaml-leaf"><span class="mdvis-yaml-cycle">（空文档）</span></div>';
      } else if (isContainer(doc)) {
        inner = yamlAny('', doc, 0, new Set());
      } else {
        inner = yamlLeaf('', doc);
      }
      tree += multi
        ? '<div class="mdvis-yaml-doc"><div class="mdvis-yaml-doc-title">文档 #' + (i + 1) + '</div>' + inner + '</div>'
        : inner;
    }

    var meta = docs.length + ' 个文档 · ' + budget.n + ' 个节点';
    return '<div class="mdvis-yaml">' +
      '<div class="mdvis-yaml-toolbar">' +
        '<button type="button" class="mdvis-yaml-tab is-active" data-mdvis-yaml-tab="tree">结构树</button>' +
        '<button type="button" class="mdvis-yaml-tab" data-mdvis-yaml-tab="source">源码</button>' +
        '<span class="mdvis-yaml-meta">' + esc(meta) + '</span>' +
      '</div>' +
      '<div class="mdvis-yaml-pane" data-mdvis-yaml-pane="tree">' + tree + '</div>' +
      '<div class="mdvis-yaml-pane" data-mdvis-yaml-pane="source" hidden>' + yamlSourceHtml(text) + '</div>' +
      '</div>';
  }

  function initYaml(root) {
    var box = root.querySelector('.mdvis-yaml');
    if (!box) return;
    box.addEventListener('click', function (ev) {
      var btn = ev.target.closest ? ev.target.closest('.mdvis-yaml-tab') : null;
      if (!btn || !box.contains(btn)) return;
      var view = btn.getAttribute('data-mdvis-yaml-tab');
      var tabs = box.querySelectorAll('.mdvis-yaml-tab');
      for (var i = 0; i < tabs.length; i++) {
        tabs[i].classList.toggle('is-active', tabs[i] === btn);
      }
      var panes = box.querySelectorAll('.mdvis-yaml-pane');
      for (var j = 0; j < panes.length; j++) {
        panes[j].hidden = panes[j].getAttribute('data-mdvis-yaml-pane') !== view;
      }
    });
  }

  /* ---------- mermaid ---------- */

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

    /** yaml 文本 -> HTML 字符串（结构树 + 源码双视图；解析失败只给源码 + 错误提示） */
    renderYaml: function (text) {
      return renderYaml(text);
    },

    /** 绑定 YAML 结构树/源码切换 */
    initYaml: function (root) {
      initYaml(root);
    },

    /** 纯文本兜底：把任意文本包成高亮块（viewer 页用） */
    renderSource: function (text, lang) {
      var body;
      if (lang && window.hljs && window.hljs.getLanguage(lang)) {
        try {
          body = window.hljs.highlight(text, { language: lang }).value;
        } catch (e) { /* 忽略 */ }
      }
      if (body === undefined) body = esc(text);
      return '<pre class="mdvis-yaml-source"><code class="hljs' +
        (lang ? ' language-' + lang : '') + '">' + body + '</code></pre>';
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
