const test = require('node:test');
const assert = require('node:assert/strict');
const { validateLink, recognizedLink } = require('../Extension/core.js');
test('preserves magnet query parameters exactly', () => {
  const link = 'magnet:?xt=urn:btih:abcdef&dn=A%20B&tr=https%3A%2F%2Fexample.com&tr=udp%3A%2F%2Ftracker';
  assert.equal(validateLink(link), link);
});
test('accepts signed URLs and explicit extensionless torrent endpoints', () => {
  for (const value of ['https://example.com/a.torrent?token=abc', 'https://example.com/download?id=5']) assert.equal(validateLink(value), value);
});
test('rejects dangerous schemes, malformed magnets and credentials', () => {
  for (const value of ['javascript:alert(1)', 'file:///tmp/a', 'magnet:?dn=test', 'https://u:p@example.com/a', 'invalid']) assert.throws(() => validateLink(value));
});
test('automatic capture is restricted to identifiable torrent links', () => {
  assert.equal(recognizedLink('https://example.com/a.TORRENT?x=1'), true);
  assert.equal(recognizedLink('https://example.com/page'), false);
  assert.equal(recognizedLink('https://example.com/page#file.torrent'), false);
});

const { normalizeServer, requestNative } = require('../Extension/core.js');
test('full server URLs set host, TLS, port and optional RPC path', () => {
  assert.deepEqual(normalizeServer({ host: 'https://transmission.example.com', port: 9091, ssl: false, path: '/transmission/rpc' }), { host: 'transmission.example.com', port: 443, ssl: true, path: '/transmission/rpc' });
  assert.equal(normalizeServer({ host: 'http://server:9091/custom/rpc' }).path, '/custom/rpc');
  assert.equal(normalizeServer({ host: 'http://server' }).port, 80);
  assert.throws(() => normalizeServer({ host: 'https://user:pass@server' }));
});
test('native callback rejects missing replies and preserves native errors', async () => {
  for (const reply of [undefined, { ok: false, error: 'Invalid host' }, { ok: true }]) {
    await assert.rejects(requestNative({ runtime: { sendNativeMessage: (_, payload, callback) => callback(reply) } }, { action: 'saveSettings' }));
  }
});
test('recognizes download query filenames without matching unrelated page parameters', () => {
  assert.equal(recognizedLink('https://fosstorrents.com/files/download.php?file=ubuntu-unity-22.04.1.iso.torrent'), true);
  assert.equal(recognizedLink('https://example.com/?q=example.torrent'), false);
  assert.equal(recognizedLink('https://example.com/?file=example.torrent.html'), false);
});
