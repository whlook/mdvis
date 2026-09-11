/* mdvis detect：文档类型判定（纯函数，无 DOM 依赖，content.js / viewer.js / node 测试共用）。 */
(function () {
  'use strict';

  var MARKDOWN_RE = /\.(md|markdown)$/i;
  var YAML_RE = /\.(ya?ml)$/i;
  var JSON_RE = /\.json$/i;
  var GZIP_RE = /\.gz$/i;
  // torch profiler 默认导出名：xx.pt.trace.json（可能再套一层 .gz）
  var PYTORCH_TRACE_NAME_RE = /\.pt\.trace\.json$/i;
  var TRACE_NAME_RE = /trace.*\.json$/i;

  // 嗅探只读文件头部：trace 的判别特征（traceEvents + 事件 cat/name）在前几十 KB 内
  var SNIFF_LIMIT = 262144;

  function stripGz(name) {
    return GZIP_RE.test(name) ? name.replace(GZIP_RE, '') : name;
  }

  /** 从 URL / 路径里取文件名（去掉 query、hash 与目录部分） */
  function fileNameOf(url) {
    var s = String(url || '').split(/[?#]/)[0];
    var i = s.lastIndexOf('/');
    s = i === -1 ? s : s.slice(i + 1);
    try {
      return decodeURIComponent(s);
    } catch (e) {
      return s;
    }
  }

  /**
   * 页面类型：决定 content script 是否接管这一页。
   * 只依据 URL 路径（必要时参考 Content-Type），避免误伤普通网页。
   */
  function docKind(pathOrUrl, contentType) {
    var p = String(pathOrUrl || '').split(/[?#]/)[0];
    if (MARKDOWN_RE.test(p)) return 'markdown';
    if (YAML_RE.test(p)) return 'yaml';
    if (JSON_RE.test(p)) return 'json';
    var ct = String(contentType || '');
    if (/markdown/i.test(ct)) return 'markdown';
    if (/ya?ml/i.test(ct)) return 'yaml';
    if (/json/i.test(ct)) return 'json';
    return null;
  }

  /**
   * 文件类型：决定 viewer 页怎么渲染（只看文件名，用于下载拦截 / 拖拽 / ?src=）。
   * 返回值：'yaml' | 'pytorch' | 'trace' | 'markdown' | null
   */
  function viewerKind(fileName) {
    var name = String(fileName || '');
    if (YAML_RE.test(stripGz(name))) return 'yaml';
    if (MARKDOWN_RE.test(name)) return 'markdown';
    if (PYTORCH_TRACE_NAME_RE.test(stripGz(name))) return 'pytorch';
    if (TRACE_NAME_RE.test(stripGz(name))) return 'trace';
    return null;
  }

  /**
   * trace 内容嗅探：text 可以是完整文本或头部片段。
   * 返回 'pytorch'（PyTorch/Kineto profiler）| 'trace'（其它 Chrome/perfetto trace）| null
   */
  function traceKind(text, fileName) {
    if (!text) return null;
    var name = String(fileName || '');
    var namedTrace = PYTORCH_TRACE_NAME_RE.test(stripGz(name)) ||
      (JSON_RE.test(stripGz(name)) && /trace/i.test(name));

    var hasEvents = /"traceEvents"\s*:\s*\[/.test(text);
    // chrome://tracing 的裸数组格式（只在文件名也像 trace 时才认）
    var bareArray = namedTrace && /^\s*\[\s*\{\s*"(ph|cat|name|ts|pid|tid)"\s*:/.test(text);
    if (!hasEvents && !bareArray) return null;

    if (PYTORCH_TRACE_NAME_RE.test(stripGz(name))) return 'pytorch';
    var pytorchMark = /"cat"\s*:\s*"(cpu_op|kernel|gpu_memcpy|gpu_memset|cuda_runtime|user_annotation|python_function|operator|ProfilerStep)"|ProfilerStep#|External id|"distributedInfo"|"baseTimeNanoseconds"|Kineto/;
    return pytorchMark.test(text) ? 'pytorch' : 'trace';
  }

  var LABELS = {
    pytorch: 'PyTorch Profiler trace',
    trace: 'Chrome/perfetto trace',
    yaml: 'YAML',
    markdown: 'Markdown',
  };

  function label(kind) {
    return LABELS[kind] || (kind ? String(kind) : '');
  }

  var api = {
    SNIFF_LIMIT: SNIFF_LIMIT,
    fileNameOf: fileNameOf,
    stripGz: stripGz,
    docKind: docKind,
    viewerKind: viewerKind,
    traceKind: traceKind,
    label: label,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  var g = typeof window !== 'undefined' ? window : (typeof self !== 'undefined' ? self : null);
  if (g) g.MDVisDetect = api;
})();
