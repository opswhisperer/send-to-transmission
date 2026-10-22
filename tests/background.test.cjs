const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
function setup(askDirectory) {
  let listener; const badgeTexts = []; const alarms = []; const calls = []; const local = {}; const tabs = [];
  const browser = {
    runtime: {
      onInstalled: { addListener() {} }, onStartup: { addListener() {} },
      getURL: value => 'safari-web-extension://test/' + value,
      onMessage: { addListener(value) { listener = value; } },
      sendNativeMessage: (_, message, callback) => {
        calls.push(message);
        callback(message.action === 'getSettings'
          ? { ok: true, settings: { host: 'test.local', askDirectory, directory: '/complete', paused: true } }
          : { ok: true, text: 'Added paused: Test' });
      }
    },
    contextMenus: { onClicked: { addListener() {} } },
    tabs: { create: async options => tabs.push(options) },
    alarms: { onAlarm: { addListener() {} }, create: async (name, options) => alarms.push({ name, ...options }), clear: async () => {} },
    action: { setBadgeText: async ({ text }) => badgeTexts.push(text), setTitle: async () => {} },
    storage: { local: { set: async values => Object.assign(local, values), get: async () => local, remove: async key => { delete local[key]; } } }
  };
  const context = vm.createContext({ browser, URL, setTimeout: (fn, ms) => { const timer = setTimeout(fn, ms); timer.unref(); return timer; }, clearTimeout, crypto: require('node:crypto').webcrypto });
  vm.runInContext(fs.readFileSync('Extension/core.js', 'utf8'), context);
  vm.runInContext(fs.readFileSync('Extension/background.js', 'utf8'), context);
  const send = message => new Promise(resolve => {
    const retained = listener(message, { url: 'https://example.com', tab: { id: 1 } }, resolve);
    assert.equal(retained, true, 'asynchronous response channel stays open');
  });
  return { listener, send, calls, local, tabs, badgeTexts, alarms, expire: () => vm.runInContext('expireBadge()', context), fail: () => vm.runInContext("rememberResult('Failed to send', true)", context) };
}
test('background rejects settings commands from web content', () => {
  const { listener, calls } = setup(true);
  assert.equal(listener({ action: 'native', payload: { action: 'getSettings' } }, { tab: { id: 1 } }, () => {}), false);
  assert.equal(calls.length, 0);
});
test('directory prompt queues a link without adding a torrent', async () => {
  const { send, calls, local, tabs } = setup(true);
  await send({ action: 'captureLink', link: 'magnet:?xt=urn:btih:abc' });
  assert.equal(calls.length, 1); assert.equal(tabs.length, 1);
  assert.equal(Object.values(local)[0].link, 'magnet:?xt=urn:btih:abc');
});
test('callback sends use configured directory and paused state', async () => {
  const { send, calls } = setup(false);
  const response = await send({ action: 'captureLink', link: 'https://fosstorrents.com/files/download.php?file=ubuntu-unity-22.04.1.iso.torrent' });
  assert.equal(response.ok, true); assert.equal(calls[1].directory, '/complete'); assert.equal(calls[1].paused, true);
});

test('fetched bytes survive directory prompt and direct add', async () => {
  for (const ask of [true, false]) {
    const { send, calls, local } = setup(ask);
    await send({ action: 'captureLink', link: 'https://example.com/download', metainfo: 'ZGU=' });
    assert.equal(ask ? Object.values(local)[0].metainfo : calls[1].metainfo, 'ZGU=');
  }
});

test('right-click review overrides immediate-send preference', async () => {
  const { send, calls, tabs, local } = setup(false);
  await send({ action: 'captureLink', link: 'https://example.com/download', metainfo: 'ZGU=', review: true });
  assert.equal(calls.length, 1);
  assert.equal(tabs.length, 1);
  assert.equal(Object.values(local)[0].metainfo, 'ZGU=');
});

test('OK badge expires without deleting the latest result; stale timeout preserves a fresh badge', async () => {
  const app = setup(false);
  await app.send({ action: 'captureLink', link: 'magnet:?xt=urn:btih:abc' });
  assert.equal(app.badgeTexts.at(-1), 'OK');
  assert.equal(app.alarms.at(-1).when, app.local.lastResult.time + 30000);
  await app.expire();
  assert.equal(app.badgeTexts.at(-1), 'OK');
  app.local.badgeExpiresAt = Date.now() - 1;
  await app.expire();
  assert.equal(app.badgeTexts.at(-1), '');
  assert.ok(app.local.lastResult.text.includes('Added'));
});
test('opening the panel clears an error badge and preserves its result; web content cannot clear it', async () => {
  const app = setup(false);
  await app.fail();
  assert.equal(app.badgeTexts.at(-1), '!');
  assert.equal(app.listener({ action: 'clearBadge' }, { url: 'https://example.com', tab: { id: 1 } }, () => {}), false);
  await new Promise(resolve => app.listener({ action: 'clearBadge' }, { url: 'safari-web-extension://test/panel.html' }, resolve));
  assert.equal(app.badgeTexts.at(-1), '');
  assert.equal(app.local.lastResult.failed, true);
  assert.equal(app.local.badgeExpiresAt, undefined);
});
