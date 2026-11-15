(() => {
  let enabled = false;
  let currentToast;
  let toastTimer;
  // kind: 'ok' fades after 10 seconds, 'busy' stays until replaced, 'failed' stays until closed.
  function toast(text, kind = 'ok') {
    const failed = kind === 'failed';
    currentToast?.remove();
    clearTimeout(toastTimer);
    const host = document.createElement('div');
    host.style.cssText = 'all:initial;position:fixed;top:24px;left:50%;transform:translateX(-50%);width:min(560px,calc(100vw - 32px));z-index:2147483647';
    const shadow = host.attachShadow({ mode: 'closed' });
    const box = document.createElement('div');
    box.style.cssText = 'display:flex;align-items:flex-start;gap:20px;padding:22px 24px;border:2px solid ' + (failed ? '#f7a99b' : kind === 'busy' ? '#9bbab3' : '#6ed5c1') + ';border-radius:14px;background:#172a30;color:white;font:17px/1.5 system-ui;box-shadow:0 8px 32px #0006;overflow-wrap:anywhere';
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
    if (kind === 'ok') toastTimer = setTimeout(() => host.remove(), 10000);
  }
  function ask(message, milliseconds, timeoutText) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(timeoutText)), milliseconds);
      try {
        browser.runtime.sendMessage(message, reply => {
          clearTimeout(timer);
          if (browser.runtime.lastError) reject(new Error('Extension messaging failed: ' + browser.runtime.lastError.message));
          else if (!reply) reject(new Error('The extension returned no reply. Reload this page after updating the extension.'));
          else if (!reply.ok) reject(new Error(reply.error));
          else resolve(reply);
        });
      } catch {
        // Safari throws here once the extension that injected this script has been updated or turned off.
        clearTimeout(timer);
        reject(new Error('The extension was updated or turned off. Reload this page and try again.'));
      }
    });
  }
  async function deliver(link, { metainfo, review = false } = {}) {
    // A stalled background page would otherwise leave the click unanswered for the whole send timeout.
    await ask({ action: 'ping' }, 5000, 'Send to Transmission is not responding. Turn the extension off and on in Safari Settings → Extensions, or reopen Safari, then try again.');
    return ask({ action: 'captureLink', link, review, ...(metainfo ? { metainfo } : {}) }, 60000,
      'Sending timed out after 60 seconds. Check Transmission before trying again; the torrent may already have been added.');
  }
  async function send(link, { fetchContents = false, review = false } = {}) {
    TransmissionCore.validateLink(link);
    const data = fetchContents && !link.startsWith('magnet:') ? await TransmissionCore.fetchTorrent(link) : null;
    return deliver(link, { metainfo: data?.metainfo, review });
  }
  // Many sites serve torrents from addresses with no .torrent in them (/download?id=5). Those cannot be
  // recognized by address, so a same-site link that describes itself as a torrent download is fetched with
  // the page's session and sent only if the reply really is a torrent. Anything else gets its click back.
  function describesTorrentDownload(element, url) {
    const words = [element.textContent.slice(0, 200), element.getAttribute('title'), element.getAttribute('aria-label'),
      element.getAttribute('class'), element.getAttribute('id'), element.querySelector('img[alt]')?.getAttribute('alt'),
      url.pathname, url.search].filter(Boolean).join(' ');
    return /torrent/i.test(words) && /down|\bdl\b|\bget\b/i.test(words);
  }
  async function sendIfTorrent(target) {
    const slow = setTimeout(() => toast('Checking this link…', 'busy'), 700);
    let data;
    try { data = await TransmissionCore.fetchTorrent(target.href); }
    catch {
      // Not a torrent, or not fetchable from the page: let Safari do what the click would have done.
      // The replayed click is untrusted, so the listener below leaves it alone.
      clearTimeout(slow); currentToast?.remove();
      target.element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, composed: true, view: window }));
      return;
    }
    clearTimeout(slow);
    toast('Sending…', 'busy');
    try { toast((await deliver(target.href, { metainfo: data.metainfo })).text); }
    catch (error) { toast(error.message, 'failed'); }
  }
  browser.runtime.onMessage.addListener((message, sender, respond) => {
    if (sender.id && sender.id !== browser.runtime.id) return false;
    // Lets the popup report whether click capture is live on this page.
    if (message.action === 'captureStatus') { respond({ ok: true, enabled }); return false; }
    if (message.action !== 'fetchTorrentLink') return false;
    send(message.link, { fetchContents: true, review: true }).then(result => { toast(result.text); respond(result); })
      .catch(error => { toast(error.message, 'failed'); respond({ ok: false, error: error.message }); });
    return true;
  });
  // The setting lives with the native settings; the background page mirrors it here for content scripts.
  browser.storage.local.get('intercept', settings => {
    if (browser.runtime.lastError) return;
    if (typeof settings?.intercept === 'boolean') enabled = settings.intercept;
    else if (window.top === window) {
      // Nothing mirrored yet (new Safari profile or cleared storage): the answer also fills the mirror.
      ask({ action: 'captureSetting' }, 10000, 'timeout').then(reply => { enabled = reply.intercept === true; }, () => {});
    }
  });
  browser.storage.onChanged.addListener(changes => {
    if (changes.intercept) enabled = changes.intercept.newValue === true;
  });
  // The link a click landed on: HTML anchors, image-map areas and SVG anchors.
  function clickedLink(event) {
    for (const element of event.composedPath()) {
      if (element instanceof HTMLAnchorElement || element instanceof HTMLAreaElement)
        return { element, href: element.href, download: element.getAttribute('download') || '', type: element.type || '' };
      if (typeof SVGAElement !== 'undefined' && element instanceof SVGAElement) {
        try { return { element, href: new URL(element.href.baseVal, element.baseURI).href, download: '', type: '' }; } catch { return null; }
      }
    }
    return null;
  }
  document.addEventListener('click', async event => {
    if (!enabled || !event.isTrusted || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const target = clickedLink(event);
    if (!target?.href) return;
    let url;
    try { url = new URL(target.href); } catch { return; }
    const web = ['http:', 'https:'].includes(url.protocol);
    // Every magnet link is taken, valid or not, so a malformed one gets an explanation here rather than
    // falling through to whichever app owns magnet links.
    const recognized = url.protocol === 'magnet:' ||
      (web && (TransmissionCore.recognizedLink(target.href) || /\.torrent$/i.test(target.download) || target.type === 'application/x-bittorrent'));
    const samePage = url.href.split('#')[0] === location.href.split('#')[0];
    const possible = !recognized && web && url.origin === location.origin && !samePage && describesTorrentDownload(target.element, url);
    if (!recognized && !possible) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (possible) return sendIfTorrent(target);
    // A page on another site must not make the server fetch from the user's own network unseen:
    // those links always open the send page so the address is reviewed first.
    const review = web && url.hostname !== location.hostname && TransmissionCore.privateHost(url.hostname);
    toast('Sending…', 'busy');
    try { toast((await send(target.href, { review })).text); }
    catch (error) { toast(error.message, 'failed'); }
  }, true);
})();
