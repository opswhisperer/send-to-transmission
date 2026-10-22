(() => {
  let enabled = false;
  let currentToast;
  let toastTimer;
  function toast(text, failed = false) {
    currentToast?.remove();
    clearTimeout(toastTimer);
    const host = document.createElement('div');
    host.style.cssText = 'all:initial;position:fixed;top:24px;left:50%;transform:translateX(-50%);width:min(560px,calc(100vw - 32px));z-index:2147483647';
    const shadow = host.attachShadow({ mode: 'closed' });
    const box = document.createElement('div');
    box.style.cssText = 'display:flex;align-items:flex-start;gap:20px;padding:22px 24px;border:2px solid ' + (failed ? '#f7a99b' : '#6ed5c1') + ';border-radius:14px;background:#172a30;color:white;font:17px/1.5 system-ui;box-shadow:0 8px 32px #0006;overflow-wrap:anywhere';
    const message = document.createElement('div');
    message.setAttribute('role', failed ? 'alert' : 'status');
    const title = document.createElement('strong');
    title.textContent = failed ? 'Could not send to Transmission' : 'Send to Transmission';
    title.style.cssText = 'display:block;margin-bottom:6px;font-size:18px';
    const detail = document.createElement('div');
    detail.textContent = text.replace(/^Added paused:/, 'Added to Transmission (paused):').replace(/^Added:/, 'Added to Transmission:');
    message.append(title, detail);
    const close = document.createElement('button');
    close.type = 'button'; close.textContent = 'Close';
    close.setAttribute('aria-label', 'Dismiss notification');
    close.style.cssText = 'margin-left:auto;flex-shrink:0;padding:6px 10px;border:1px solid #9bbab3;border-radius:6px;background:transparent;color:white;font:14px system-ui;cursor:pointer';
    close.onclick = () => { host.remove(); clearTimeout(toastTimer); };
    box.append(message, close); shadow.append(box); document.documentElement.append(host);
    currentToast = host;
    if (!failed) toastTimer = setTimeout(() => host.remove(), 10000);
  }
  async function send(link, fetchContents) {
    TransmissionCore.validateLink(link);
    const data = fetchContents && !link.startsWith('magnet:') ? await TransmissionCore.fetchTorrent(link) : null;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Send timed out.')), 45000);
      browser.runtime.sendMessage({ action: 'captureLink', link, review: fetchContents, ...(data ? { metainfo: data.metainfo } : {}) }, reply => {
        clearTimeout(timer);
        if (browser.runtime.lastError) reject(new Error('Extension messaging failed: ' + browser.runtime.lastError.message));
        else if (!reply) reject(new Error('The extension returned no reply. Reload this page after updating the extension.'));
        else if (!reply.ok) reject(new Error(reply.error));
        else resolve(reply);
      });
    });
  }
  browser.runtime.onMessage.addListener((message, sender, respond) => {
    if (sender.id && sender.id !== browser.runtime.id) return false;
    if (message.action !== 'fetchTorrentLink') return false;
    send(message.link, true).then(result => { toast(result.text); respond(result); })
      .catch(error => { toast(error.message, true); respond({ ok: false, error: error.message }); });
    return true;
  });
  browser.storage.local.get('intercept', settings => {
    if (!browser.runtime.lastError) enabled = settings?.intercept === true;
  });
  browser.storage.onChanged.addListener(changes => {
    if (changes.intercept) enabled = changes.intercept.newValue === true;
  });
  document.addEventListener('click', async event => {
    if (!enabled || !event.isTrusted || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const anchor = event.composedPath().find(el => el instanceof HTMLAnchorElement);
    if (!anchor) return;
    let url;
    try { url = new URL(anchor.href); } catch { return; }
    const torrentAttribute = ['http:', 'https:'].includes(url.protocol) &&
      (/\.torrent$/i.test(anchor.getAttribute('download') || '') || anchor.type === 'application/x-bittorrent');
    if (!TransmissionCore.recognizedLink(anchor.href) && !torrentAttribute) return;
    if (!['http:', 'https:', 'magnet:'].includes(url.protocol)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    try { toast((await send(anchor.href, false)).text); }
    catch (error) { toast(error.message, true); }
  }, true);
})();
