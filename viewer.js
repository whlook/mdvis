/* mdvis viewer：本地文件 / URL 查看器。
 *  - .pt.trace.json / *.trace.json（含 .gz）→ 推给 Perfetto UI（内嵌 iframe）
 *  - .yaml / .yml → 结构树 + 源码
 *  - .md → 渲染文档；其它文本 → 高亮源码
 * 由 background 打开（?src=...），也可直接拖拽 / 选择文件。 */
(function () {
  'use strict';

  var D = window.MDVisDetect;
  var R = window.MDVisRenderer;
  var stage = document.getElementById('stage');
  var nameEl = document.getElementById('name');
  var statusEl = document.getElementById('status');
  var fileInput = document.getElementById('file');
  var tabBtn = document.getElementById('perfetto-tab');

  var currentName = '';
  var currentBuffer = null; // ArrayBuffer，推给 Perfetto 的原始（解压后）字节；推送后会被 transfer 走
  var currentLoader = null; // () => Promise<ArrayBuffer>，buffer 被 transfer 后用来重新读取

  var SOURCE_SIZE_LIMIT = 32 * 1024 * 1024; // 源码兜底视图的体积上限

  function setStatus(text, isError) {
    statusEl.textContent = text || '';
    statusEl.classList.toggle('is-error', !!isError);
  }

  function fmtBytes(n) {
    if (n < 1024) return n + ' B';
    if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
    if (n < 1073741824) return (n / 1048576).toFixed(1) + ' MB';
    return (n / 1073741824).toFixed(2) + ' GB';
  }

  function isGzip(u8) {
    return u8.length > 2 && u8[0] === 0x1f && u8[1] === 0x8b;
  }

  function looksBinary(u8) {
    var n = Math.min(u8.length, 8192);
    for (var i = 0; i < n; i++) {
      if (u8[i] === 0) return true;
    }
    return false;
  }

  function decodeText(buffer) {
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
    } catch (e) {
      return new TextDecoder('gbk').decode(buffer); // 兼容 GBK 编码的旧文件
    }
  }

  function langForName(name) {
    var ext = (String(name).split('.').pop() || '').toLowerCase();
    var map = {
      yaml: 'yaml', yml: 'yaml', json: 'json', md: 'markdown', markdown: 'markdown',
      py: 'python', sh: 'bash', bash: 'bash', zsh: 'bash', c: 'c', cpp: 'cpp', cc: 'cpp',
      cxx: 'cpp', h: 'cpp', hpp: 'cpp', cu: 'cpp', js: 'javascript', ts: 'typescript',
      toml: 'ini', ini: 'ini', cfg: 'ini', conf: 'ini', xml: 'xml', html: 'xml',
      css: 'css', sql: 'sql', go: 'go', rs: 'rust', java: 'java',
    };
    return map[ext] || '';
  }

  /* ---------- Perfetto ---------- */

  function waitForPerfetto(target, timeoutMs) {
    // Perfetto 的 postMessage 通道不带缓冲：反复 PING，收到 PONG 才算就绪
    return new Promise(function (resolve, reject) {
      var started = Date.now();
      var timer = setInterval(function () {
        if (Date.now() - started > timeoutMs) {
          cleanup();
          reject(new Error('等待 Perfetto 就绪超时'));
          return;
        }
        ping();
      }, 200);
      function onMsg(ev) {
        if (ev.source === target && ev.data === 'PONG') {
          cleanup();
          resolve();
        }
      }
      function ping() {
        try { target.postMessage('PING', '*'); } catch (e) { /* 窗口未就绪 */ }
      }
      function cleanup() {
        clearInterval(timer);
        window.removeEventListener('message', onMsg);
      }
      window.addEventListener('message', onMsg);
      ping();
    });
  }

  // buffer 可能已被上一次推送 transfer 走，此时重新读一遍
  async function traceBuffer() {
    if (currentBuffer && currentBuffer.byteLength > 0) return currentBuffer;
    if (!currentLoader) throw new Error('需要重新选择文件');
    setStatus('正在重新读取文件…');
    currentBuffer = await currentLoader();
    return currentBuffer;
  }

  async function postTrace(target) {
    var buffer = await traceBuffer();
    target.postMessage({
      perfetto: {
        buffer: buffer,
        title: currentName || 'mdvis trace',
        fileName: currentName || 'trace.json',
        localOnly: false, // 允许在 Perfetto 里下载/分享这份 trace
      },
    }, '*', [buffer]); // 转移所有权，避免大 trace 再复制一份
  }

  function openPerfetto(container) {
    setStatus('正在加载 Perfetto UI（ui.perfetto.dev）…');
    container.innerHTML = '';
    var frame = document.createElement('iframe');
    frame.className = 'mdvis-perfetto';
    frame.title = 'Perfetto';
    frame.src = 'https://ui.perfetto.dev/';
    container.appendChild(frame);
    waitForPerfetto(frame.contentWindow, 90000)
      .then(function () { return postTrace(frame.contentWindow); })
      .then(function () {
        setStatus('已推送给 Perfetto。若弹出 “is trying to open a trace file”，选 Always trust 后不再询问。');
      })
      .catch(function (e) {
        setStatus('内嵌 Perfetto 打开失败：' + e.message + '（可点上方「在 ui.perfetto.dev 打开」）', true);
      });
  }

  tabBtn.addEventListener('click', function () {
    if (!currentName) {
      setStatus('没有已加载的 trace', true);
      return;
    }
    var win = window.open('https://ui.perfetto.dev/', '_blank');
    if (!win) {
      setStatus('弹窗被浏览器拦截，请允许本页弹出窗口后重试', true);
      return;
    }
    setStatus('正在独立标签页中打开 Perfetto…');
    waitForPerfetto(win, 90000)
      .then(function () { return postTrace(win); })
      .then(function () { setStatus('已在独立标签页载入 Perfetto'); })
      .catch(function (e) { setStatus('打开失败：' + e.message, true); });
  });

  /* ---------- 渲染 ---------- */

  function renderDoc(html) {
    stage.innerHTML = '';
    var wrap = document.createElement('div');
    wrap.className = 'mdvis-viewer-doc';
    var container = document.createElement('div');
    container.className = 'mdvis-container';
    container.innerHTML = html;
    wrap.appendChild(container);
    stage.appendChild(wrap);
    return container;
  }

  async function gunzip(buffer) {
    if (typeof DecompressionStream === 'undefined') {
      throw new Error('当前 Chrome 不支持 gzip 解压，请先自行 gunzip');
    }
    setStatus('正在解压 gzip…');
    var stream = new Blob([buffer]).stream().pipeThrough(new DecompressionStream('gzip'));
    return await new Response(stream).arrayBuffer();
  }

  async function show(name, buffer, kindHint, loader) {
    currentName = name || '未命名';
    currentLoader = loader || null;
    nameEl.textContent = currentName;
    document.title = currentName + ' — mdvis';
    tabBtn.hidden = true;
    stage.innerHTML = '';

    var u8 = new Uint8Array(buffer);
    if (isGzip(u8)) {
      buffer = await gunzip(buffer);
      u8 = new Uint8Array(buffer);
    }
    currentBuffer = buffer;

    var kind = kindHint || D.viewerKind(currentName);
    if (kind === 'pytorch' || kind === 'trace') {
      tabBtn.hidden = false;
      openPerfetto(stage);
      return;
    }

    if (looksBinary(u8)) throw new Error('二进制文件，无法预览（' + fmtBytes(u8.length) + '）');

    var text = decodeText(buffer);
    if (!kind && D.traceKind(text.slice(0, D.SNIFF_LIMIT), currentName)) {
      tabBtn.hidden = false;
      openPerfetto(stage);
      return;
    }

    if (kind === 'yaml') {
      R.initYaml(renderDoc(R.renderYaml(text)));
      setStatus('YAML · ' + fmtBytes(u8.length));
      return;
    }
    if (kind === 'markdown') {
      setStatus('Markdown · ' + fmtBytes(u8.length));
      await R.renderMermaid(renderDoc(R.renderMarkdown(text)));
      return;
    }

    if (u8.length > SOURCE_SIZE_LIMIT) {
      setStatus('文件过大（' + fmtBytes(u8.length) + '），已跳过预览', true);
      renderDoc('<div class="mdvis-error">文件过大（' + fmtBytes(u8.length) + '），已跳过预览。</div>');
      return;
    }
    var lang = langForName(currentName);
    renderDoc(R.renderSource(text, lang));
    setStatus((lang || 'text') + ' · ' + fmtBytes(u8.length));
  }

  async function load(name, buffer, kindHint, loader) {
    try {
      await show(name, buffer, kindHint, loader);
    } catch (e) {
      var msg = String((e && e.message) || e);
      setStatus(msg, true);
      renderDoc('<div class="mdvis-error">打开失败：' + msg + '</div>');
    }
  }

  /* ---------- 读取文件 / URL ---------- */

  async function readUrl(url) {
    var resp;
    try {
      resp = await fetch(url, { credentials: 'include' });
    } catch (e) {
      throw new Error('读取失败：' + e.message +
        (url.indexOf('file:') === 0
          ? '。若为本地文件，请在 chrome://extensions 里为 mdvis 打开「允许访问文件网址」，或把文件拖到本页'
          : ''));
    }
    if (!resp.ok) throw new Error('HTTP ' + resp.status + ' ' + resp.statusText);
    var total = Number(resp.headers.get('content-length') || 0);
    if (!resp.body) return await resp.arrayBuffer();
    var reader = resp.body.getReader();
    var chunks = [];
    var received = 0;
    var tick = Date.now();
    for (;;) {
      var step = await reader.read();
      if (step.done) break;
      chunks.push(step.value);
      received += step.value.byteLength;
      if (Date.now() - tick > 150) {
        setStatus('正在读取 ' + fmtBytes(received) + (total ? ' / ' + fmtBytes(total) : '') + ' …');
        tick = Date.now();
      }
    }
    var out = new Uint8Array(received);
    var off = 0;
    for (var i = 0; i < chunks.length; i++) {
      out.set(chunks[i], off);
      off += chunks[i].byteLength;
    }
    return out.buffer;
  }

  function dropZone() {
    stage.innerHTML =
      '<div class="mdvis-viewer-drop">' +
      '<h1>把文件拖到这里</h1>' +
      '<div>支持 <code>.yaml</code> / <code>.yml</code>、<code>*.pt.trace.json(.gz)</code>、' +
      '<code>*.trace.json(.gz)</code>、<code>.md</code> 及普通文本</div>' +
      '<div>trace 会直接送进 Perfetto（ui.perfetto.dev）打开</div>' +
      '</div>';
    setStatus('等待文件…');
  }

  document.getElementById('pick').addEventListener('click', function () {
    fileInput.click();
  });

  fileInput.addEventListener('change', async function () {
    var file = fileInput.files && fileInput.files[0];
    if (!file) return;
    nameEl.textContent = file.name;
    setStatus('正在读取 ' + fmtBytes(file.size) + ' …');
    var loader = function () { return file.arrayBuffer(); };
    await load(file.name, await loader(), '', loader);
    fileInput.value = '';
  });

  ['dragenter', 'dragover'].forEach(function (type) {
    document.addEventListener(type, function (ev) {
      ev.preventDefault();
      document.body.classList.add('mdvis-dragging');
    });
  });
  ['dragleave', 'dragend'].forEach(function (type) {
    document.addEventListener(type, function (ev) {
      if (ev.target === document.documentElement || ev.target === document.body) {
        document.body.classList.remove('mdvis-dragging');
      }
    });
  });
  document.addEventListener('drop', async function (ev) {
    ev.preventDefault();
    document.body.classList.remove('mdvis-dragging');
    var file = ev.dataTransfer && ev.dataTransfer.files && ev.dataTransfer.files[0];
    if (!file) return;
    nameEl.textContent = file.name;
    setStatus('正在读取 ' + fmtBytes(file.size) + ' …');
    try {
      var loader = function () { return file.arrayBuffer(); };
      await load(file.name, await loader(), '', loader);
    } catch (e) {
      setStatus('读取失败：' + e.message, true);
    }
  });

  /* ---------- 入口 ---------- */

  (async function () {
    var params = new URLSearchParams(location.search);
    var src = params.get('src');
    var kind = params.get('kind') || '';
    if (!src) {
      dropZone();
      return;
    }
    var name = D.fileNameOf(src);
    nameEl.textContent = name;
    setStatus('正在读取 ' + src + ' …');
    var loader = function () { return readUrl(src); };
    try {
      await load(name, await loader(), kind, loader);
    } catch (e) {
      setStatus(String(e.message || e), true);
      stage.innerHTML = '<div class="mdvis-viewer-doc"><div class="mdvis-error">' +
        String(e.message || e) + '</div></div>';
    }
  })();
})();
