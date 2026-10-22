/* Shared validation is also exercised by the Node tests. */
(function (root) {
  function validateLink(value) {
    const link = String(value || '').trim();
    if (link.length > 65536) throw new Error('This link is too long.');
    let url;
    try { url = new URL(link); } catch { throw new Error('Enter a magnet link or an HTTP(S) torrent URL.'); }
    if (url.protocol === 'magnet:') {
      if (!url.searchParams.getAll('xt').some(x => /^urn:(btih|btmh):.+$/i.test(x)))
        throw new Error('The magnet link is missing its torrent identifier.');
    } else if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password) {
      throw new Error('Use a magnet link or an HTTP(S) torrent URL without embedded login details.');
    }
    return link;
  }
  function recognizedLink(value) {
    try {
      const url = new URL(validateLink(value));
      return url.protocol === 'magnet:' || /\.torrent$/i.test(url.pathname) ||
        ['file', 'filename', 'download'].some(key => /\.torrent$/i.test(url.searchParams.get(key) || ''));
    } catch { return false; }
  }
  function normalizeServer(settings) {
    const result = { ...settings, host: settings.host.trim() };
    if (!result.host.includes('://')) return result;
    let url;
    try { url = new URL(result.host); } catch { throw new Error('Enter a valid server hostname or HTTP(S) URL.'); }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash)
      throw new Error('Use an HTTP(S) server URL without login details, query parameters, or a fragment.');
    result.host = url.hostname;
    result.ssl = url.protocol === 'https:';
    result.port = url.port ? Number(url.port) : (result.ssl ? 443 : 80);
    if (url.pathname !== '/') result.path = decodeURI(url.pathname);
    return result;
  }
  function requestNative(browser, payload) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('The extension did not respond. Rebuild and run it in Xcode, then reopen the Safari popup.')), 45000);
      try {
        // Use Safari's documented callback API; never assume a missing reply is success.
        browser.runtime.sendNativeMessage('application.id', payload, reply => {
          clearTimeout(timer);
          const error = browser.runtime.lastError;
          if (error) return reject(new Error(error.message || 'Native messaging failed.'));
          if (!reply?.ok) return reject(new Error(reply?.error || 'No response from the native extension. Rebuild and run it in Xcode, then reopen the popup.'));
          if (['getSettings', 'saveSettings'].includes(payload.action) && !reply.settings)
            return reject(new Error('The native extension returned incomplete settings. Rebuild and run the latest version.'));
          resolve(reply);
        });
      } catch (error) { clearTimeout(timer); reject(error); }
    });
  }
async function fetchTorrent(link) {
  const url = new URL(link, location.href);
  if (url.origin !== location.origin) throw new Error('This link points to another website. Download the torrent in Safari and use its magnet link or a public torrent URL.');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    // One GET avoids HEAD incompatibility and consuming one-use links twice.
    const response = await fetch(url, { credentials: 'same-origin', redirect: 'error', signal: controller.signal });
    const type = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    const disposition = response.headers.get('content-disposition') || '';
    const namedTorrent = /filename\*?\s*=\s*(?:UTF-8''|\")?[^;\r\n]*\.torrent(?:\"|\s|;|$)/i.test(disposition);
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error('Download returned HTTP ' + response.status + '. Check that you are logged into this website.');
    }
    // Some download endpoints supply only generic binary headers; native validation remains authoritative.
    if (!(type === 'application/x-bittorrent' || namedTorrent || type === 'application/octet-stream' || !type)) {
      await response.body?.cancel();
      throw new Error('Response is not identified as a torrent (possibly a login page).');
    }
    const reader = response.body.getReader();
    const chunks = []; let size = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 2 * 1024 * 1024) { await reader.cancel(); throw new Error('Torrent exceeds 2 MB size limit.'); }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    // Reject obvious non-torrents here; the native handler validates the bencoded structure.
    if (bytes[0] !== 100 || bytes[bytes.length - 1] !== 101) throw new Error('Invalid torrent envelope.');
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return { metainfo: btoa(binary), size, type, disposition };
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('Fetching the torrent timed out after 10 seconds.');
    if (error instanceof TypeError) throw new Error('Safari could not fetch this download: ' + error.message + '. Redirects, cross-site downloads, or website restrictions may prevent access.');
    throw error;
  } finally { clearTimeout(timeout); }
}
  const api = { validateLink, recognizedLink, normalizeServer, requestNative, fetchTorrent };
  root.TransmissionCore = api;
  if (typeof module !== 'undefined') module.exports = api;
})(globalThis);
