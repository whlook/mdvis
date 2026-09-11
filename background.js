/* mdvis background：
 *  - 打开 viewer 页（content script 无法直接跳到 chrome-extension:// 页面）
 *  - 工具栏图标入口
 *  - 拦截本地 .yaml / .json.gz 的“下载”（Chrome 显示不了这些类型，只能下载），改为就地渲染 */
'use strict';

importScripts('detect.js');

var D = self.MDVisDetect;
var VIEWER = 'viewer.html';
var openedTabs = new Map(); // src -> tabId，避免同一文件重复开标签页

function viewerUrl(src, kind) {
  var url = chrome.runtime.getURL(VIEWER);
  var query = [];
  if (src) query.push('src=' + encodeURIComponent(src));
  if (kind) query.push('kind=' + encodeURIComponent(kind));
  return query.length ? url + '?' + query.join('&') : url;
}

function openViewer(src, kind, active) {
  var url = viewerUrl(src, kind);
  var existing = src ? openedTabs.get(src) : null;
  if (existing != null) {
    chrome.tabs.update(existing, { active: active !== false }, function () {
      if (chrome.runtime.lastError) {
        openedTabs.delete(src);
        openViewer(src, kind, active);
        return;
      }
      chrome.tabs.get(existing, function (tab) {
        void chrome.runtime.lastError;
        if (tab && tab.windowId != null) chrome.windows.update(tab.windowId, { focused: true });
      });
    });
    return;
  }
  chrome.tabs.create({ url: url, active: active !== false }, function (tab) {
    void chrome.runtime.lastError;
    if (src && tab && tab.id != null) openedTabs.set(src, tab.id);
  });
}

chrome.tabs.onRemoved.addListener(function (tabId) {
  openedTabs.forEach(function (id, src) {
    if (id === tabId) openedTabs.delete(src);
  });
});

chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
  if (!msg || msg.type !== 'mdvis:openViewer' || !msg.src) return false;
  openViewer(msg.src, msg.kind, true);
  sendResponse({ ok: true });
  return false;
});

// 工具栏图标：当前标签页本身就是可查看的文件时直接带上，否则给出拖拽页
chrome.action.onClicked.addListener(function (tab) {
  var url = (tab && tab.url) || '';
  var kind = D.viewerKind(D.fileNameOf(url));
  chrome.tabs.create({ url: viewerUrl(kind ? url : '', kind) });
});

/* ---------- 下载接管 ----------
 * file:///x.yaml、file:///x.pt.trace.json.gz 这类地址 Chrome 不会直接显示，而是弹下载。
 * 必须在 onCreated 就立刻接管：
 *   - 先打开查看器（读的是磁盘上的原文件，不需要这份副本），再取消这次下载；
 *   - 不能等下载完成 —— 装了下载管理器类扩展（Chrono 等）时，原生下载会被它们立刻取消
 *     （interrupt_reason = USER_CANCELED），等完成就永远不会触发。
 * 取消晚了一步、文件已落盘时，则在 onChanged 里把副本删掉。 */
var pending = new Map(); // downloadId -> {src, kind}

// 判断这次下载要不要接管：返回查看器类型，或 null
function takeoverKind(item) {
  if (!item || !item.url) return null;
  var name = D.fileNameOf(item.url) || item.filename || '';
  var kind = D.viewerKind(name);
  if (!kind) return null;
  // 本地文件：Chrome 根本显示不了 .yaml / .json.gz，接管后读原文件即可
  if (item.url.indexOf('file:') === 0) return kind;
  // 远端：只接管 trace（点开 trace 就是为了看，Perfetto 里还能再下载）；
  // 远端的 yaml 往往是明确想下载，不抢
  if (kind === 'pytorch' || kind === 'trace') return kind;
  return null;
}

chrome.downloads.onCreated.addListener(function (item) {
  var kind = takeoverKind(item);
  if (!kind) return;
  pending.set(item.id, { src: item.url, kind: kind });
  openViewer(item.url, kind, true);
  chrome.downloads.cancel(item.id, function () {
    void chrome.runtime.lastError; // 可能已被其它下载管理器抢先取消
    chrome.downloads.erase({ id: item.id }, function () { void chrome.runtime.lastError; });
  });
});

chrome.downloads.onChanged.addListener(function (delta) {
  if (!pending.has(delta.id)) return;
  var state = delta.state && delta.state.current;
  if (state === 'complete') {
    pending.delete(delta.id);
    // 取消晚了，文件已经落盘 → 删掉这份重复副本
    chrome.downloads.removeFile(delta.id, function () {
      void chrome.runtime.lastError;
      chrome.downloads.erase({ id: delta.id }, function () { void chrome.runtime.lastError; });
    });
  } else if (state === 'interrupted') {
    pending.delete(delta.id);
    chrome.downloads.erase({ id: delta.id }, function () { void chrome.runtime.lastError; });
  }
});
