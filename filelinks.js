/* mdvis filelinks：file:// 页面（目录列表 / 本地 HTML）里点击 yaml / trace 链接时直接接管，
 * 不让 Chrome 先创建下载（下载接管钩子仍作为兜底：书签、历史记录、拖拽等入口）。
 * 只在点击「Chrome 自己显示不了的本地文件」时动手，普通文件与 .md 走默认行为。 */
(function () {
  'use strict';

  if (location.protocol !== 'file:') return;
  var D = window.MDVisDetect;
  if (!D) return;

  // Chrome 能自己显示的（md 会被 mdvis 就地渲染）不拦，只拦必须绕道的类型
  function needsViewer(kind) {
    return kind === 'yaml' || kind === 'pytorch' || kind === 'trace';
  }

  document.addEventListener('click', function (ev) {
    if (ev.defaultPrevented || ev.button !== 0) return;
    // 带修饰键的点击（新标签页打开等）交给浏览器默认行为，下载钩子兜底
    if (ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey) return;
    var target = ev.target;
    var link = target && target.closest ? target.closest('a[href]') : null;
    if (!link) return;
    var href = link.href || '';
    if (href.indexOf('file:') !== 0) return;
    var kind = D.viewerKind(D.fileNameOf(href));
    if (!needsViewer(kind)) return;

    ev.preventDefault();
    ev.stopPropagation();

    if (window.chrome && chrome.runtime && chrome.runtime.sendMessage) {
      chrome.runtime.sendMessage({ type: 'mdvis:openViewer', src: href, kind: kind }, function () {
        void chrome.runtime.lastError;
      });
    } else {
      location.href = href; // 没有扩展 API 时退化为普通导航
    }
  }, true);
})();
