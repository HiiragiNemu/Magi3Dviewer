/* This deliberately uses ES5 and no imports. It must run before the module
 * graph, including when a browser rejects or cannot download that graph.
 * Diagnostics stay on the device; no telemetry, cache clearing or auto-reload. */
(function (window, document) {
    'use strict';
    if (window.__magiusStartup) return;
    var started = Date.now(), ready = false, stage = 'module-loading';
    var errors = [], root = null, timer = null, delayed = false;
    var locale = 'zh-CN';
    try { locale = window.localStorage.getItem('magius3dviewer.locale') || locale; } catch (_) {}
    var words = locale === 'en' ? {
        wait: 'The viewer is still starting', fail: 'The viewer could not start',
        hint: 'Startup did not finish. The details below distinguish a failed script download from a browser or WebGL error.',
        slow: 'The startup script is still downloading or initializing. This is not yet a confirmed failure. You may keep waiting.',
        retry: 'Retry startup', copy: 'Copy diagnostic details', copied: 'Copied',
        select: 'Select and copy the details below', loading: 'Loading the viewer and character resources…'
    } : locale === 'ja-JP' ? {
        wait: 'ビューアーを起動しています', fail: 'ビューアーを起動できませんでした',
        hint: '起動が完了しませんでした。スクリプトの通信エラーとブラウザー・WebGLのエラーを下に表示します。',
        slow: '起動スクリプトの読み込みまたは初期化が続いています。まだ失敗とは確定していません。',
        retry: '起動を再試行', copy: '診断情報をコピー', copied: 'コピーしました',
        select: '下の情報を選択してコピーしてください', loading: 'ビューアーとモデルを読み込み中…'
    } : {
        wait: '查看器仍在启动', fail: '查看器启动失败',
        hint: '页面没有完成初始化。下方会显示实际错误，用于区分脚本下载失败、浏览器执行异常和 WebGL 启动异常。',
        slow: '启动脚本仍在下载或初始化，尚不能判定为故障。可以继续等待；不会自动刷新或清除已保存的姿态。',
        retry: '重新尝试启动', copy: '复制诊断信息', copied: '已复制',
        select: '请选中下方内容复制', loading: '正在加载查看器与角色资源…'
    };
    function clean(value) {
        return String(value || '').replace(/https?:\/\/[^\s)"']+/g, function (url) {
            return url.split('?')[0].split('#')[0];
        }).slice(0, 1400);
    }
    function version() {
        var meta = document.querySelector('meta[name="magius-build-revision"]');
        return meta ? meta.content : 'development';
    }
    function snapshot() {
        var resources = [], entries, i, item;
        try {
            entries = window.performance.getEntriesByType('resource');
            for (i = 0; i < entries.length; i++) {
                item = entries[i];
                if (/\/assets\/.*\.js(?:\?|$)/.test(item.name)) resources.push({
                    url: clean(item.name), durationMs: Math.round(item.duration),
                    transferredBytes: item.transferSize, decodedBytes: item.decodedBodySize
                });
            }
        } catch (_) {}
        return {
            schema: 'magius.startup-diagnostic.v1', revision: version(), stage: stage,
            status: ready ? 'ready' : errors.length ? 'failed' : delayed ? 'pending-longer-than-expected' : 'pending',
            elapsedMs: Date.now() - started, userAgent: window.navigator.userAgent,
            page: window.location.origin + window.location.pathname,
            features: {webgl2API: typeof window.WebGL2RenderingContext !== 'undefined',
                resizeObserver: typeof window.ResizeObserver !== 'undefined',
                abortController: typeof window.AbortController !== 'undefined',
                structuredClone: typeof window.structuredClone === 'function'},
            errors: errors.slice(), completedScripts: resources.slice(-12)
        };
    }
    function refresh() {
        if (ready || !root) return;
        root.querySelector('strong').textContent = errors.length ? words.fail : words.wait;
        root.querySelector('p').textContent = errors.length ? words.hint : words.slow;
        var detail = root.querySelector('textarea');
        // Do not destroy a mobile text selection while the user is copying it.
        if (document.activeElement !== detail) detail.value = JSON.stringify(snapshot(), null, 2);
    }
    function show() {
        if (ready || !document.body) return;
        if (!root) {
            root = document.createElement('section');
            root.id = 'magius-startup-diagnostic'; root.setAttribute('role', 'alert');
            root.setAttribute('data-i18n-ignore', 'true');
            root.style.cssText = 'position:fixed;z-index:2147483646;left:12px;right:12px;top:18px;max-width:680px;margin:0 auto;padding:16px;box-sizing:border-box;color:#eaf1f5;background:#17232f;border:1px solid #829aa6;border-radius:8px;font:15px/1.45 sans-serif;max-height:calc(100vh - 36px);overflow:auto;text-align:left';
            var title = document.createElement('strong'), hint = document.createElement('p');
            var controls = document.createElement('div'), retry = document.createElement('button'), copy = document.createElement('button');
            var detail = document.createElement('textarea');
            title.style.cssText = 'font-size:18px';
            retry.type = copy.type = 'button'; retry.textContent = words.retry; copy.textContent = words.copy;
            retry.style.cssText = copy.style.cssText = 'margin:0 8px 10px 0;padding:8px 12px;font:inherit;color:#14222a;background:#eef6f7;border:1px solid #b7cbd4;border-radius:4px;cursor:pointer';
            detail.readOnly = true; detail.setAttribute('aria-label', 'Startup diagnostic details');
            detail.style.cssText = 'display:block;width:100%;height:220px;box-sizing:border-box;background:#0d151d;color:#f1f5f7;border:1px solid #829aa6;padding:8px;font:12px/1.35 monospace;resize:vertical';
            retry.onclick = function () { window.location.reload(); };
            copy.onclick = function () {
                refresh();
                if (window.navigator.clipboard && window.navigator.clipboard.writeText) {
                    window.navigator.clipboard.writeText(detail.value).then(function () { copy.textContent = words.copied; }, function () { detail.focus(); detail.select(); copy.textContent = words.select; });
                } else { detail.focus(); detail.select(); copy.textContent = words.select; }
            };
            controls.appendChild(retry); controls.appendChild(copy);
            root.appendChild(title); root.appendChild(hint); root.appendChild(controls); root.appendChild(detail); document.body.appendChild(root);
        }
        refresh();
    }
    function fail(kind, message, source, line) {
        if (ready || errors.length >= 6) return;
        var entry = {kind: kind, message: clean(message), source: clean(source), line: line || 0};
        if (errors.length && JSON.stringify(errors[errors.length - 1]) === JSON.stringify(entry)) return;
        errors.push(entry); show();
    }
    function onError(event) {
        if (ready) return;
        var target = event.target;
        if (target && target !== window && /^(SCRIPT|LINK)$/.test(target.tagName)) {
            if (target.tagName === 'LINK' && target.rel !== 'modulepreload' && target.rel !== 'stylesheet') return;
            fail('resource-load', 'Startup resource could not be loaded', target.src || target.href, 0);
        } else if (event.message) {
            // Vite's deliberate syntax probe may fail in its supported legacy
            // branch. Let that branch finish rather than labeling it a crash.
            if (/import\.meta|Unexpected token ['"]?\*/.test(event.message) && !event.filename) return;
            fail('javascript', event.message, event.filename, event.lineno);
        }
    }
    function onRejection(event) {
        var reason = event.reason;
        fail('unhandled-rejection', reason && reason.message || reason, reason && reason.stack, 0);
    }
    function finish() {
        if (ready) return;
        ready = true; stage = 'viewer-ready';
        if (timer !== null) window.clearInterval(timer);
        if (root && root.parentNode) root.parentNode.removeChild(root);
        root = null;
        window.removeEventListener('error', onError, true);
        window.removeEventListener('unhandledrejection', onRejection);
    }
    window.__magiusStartup = {snapshot: snapshot, fail: fail, ready: finish};
    window.addEventListener('error', onError, true);
    window.addEventListener('unhandledrejection', onRejection);
    window.addEventListener('magius:bootstrap-stage', function (event) { if (!ready) stage = String(event.detail || 'initializing'); });
    window.addEventListener('magius:bootstrap-ready', finish);
    timer = window.setInterval(function () {
        if (ready) return;
        var label = document.querySelector('#stat .demo');
        if (label && !errors.length) label.textContent = words.loading;
        delayed = Date.now() - started >= 20000;
        if (errors.length || delayed) show();
    }, 1000);
}(window, document));
