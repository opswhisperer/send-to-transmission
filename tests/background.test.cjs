const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
function setup(askDirectory, { native = {}, stored = {} } = {}) {
  let listener; const badgeTexts = []; const alarms = []; const calls = []; const local = {}; const tabs = []; const menus = []; const saved = [];
  const settings = { host: 'test.local', askDirectory, directory: '/complete', paused: true, ...native };
  const browser = {
    runtime: {
      onInstalled: { addListener() {} }, onStartup: { addListener() {} },
      getURL: value => 'safari-web-extension://test/' + value,
      onMessage: { addListener(value) { listener = value; } },
      sendNativeMessage: (_, message, callback) => {
        // The startup capture sync is recorded separately so send tests count only their own calls.
        if (message.action === 'saveSettings') { saved.push(message.settings); Object.assign(settings, message.settings); return callback({ ok: true, settings }); }
        if (message.action === 'getSettings' && !started) return callback({ ok: true, settings });
        calls.push(message);
        callback(message.action === 'getSettings' ? { ok: true, settings } : { ok: true, text: 'Added paused: Test' });
      }
    },
    contextMenus: { onClicked: { addListener() {} }, removeAll: callback => { menus.length = 0; callback(); }, create: (item, callback) => { menus.push(item.id); callback?.(); } },
    tabs: { create: async options => tabs.push(options) },
    alarms: { onAlarm: { addListener() {} }, create: async (name, options) => alarms.push({ name, ...options }), clear: async () => {} },
    action: { setBadgeText: async ({ text }) => badgeTexts.push(text), setTitle: async () => {} },
    storage: { local: { set: async values => Object.assign(local, values), get: async () => local, remove: async key => { delete local[key]; } } }
  };
  Object.assign(local, stored);
  let started = false;
  const context = vm.createContext({ browser, URL, setTimeout: (fn, ms) => { const timer = setTimeout(fn, ms); timer.unref(); return timer; }, clearTimeout, crypto: require('node:crypto').webcrypto });
  vm.runInContext(fs.readFileSync('Extension/core.js', 'utf8'), context);
  vm.runInContext(fs.readFileSync('Extension/background.js', 'utf8'), context);
  const send = message => new Promise(resolve => {
    const retained = listener(message, { url: 'https://example.com', tab: { id: 1 } }, resolve);
    assert.equal(retained, true, 'asynchronous response channel stays open');
  });
  const pending = () => Object.entries(local).filter(([key]) => key.startsWith('pending:')).map(([, value]) => value);
  // Lets the top-level capture sync and menu registration settle before a test begins.
  const ready = new Promise(resolve => setTimeout(() => { started = true; resolve(); }, 5));
  return { ready, listener, send, calls, local, tabs, badgeTexts, alarms, menus, saved, pending, expire: () => vm.runInContext('expireBadge()', context), fail: () => vm.runInContext("rememberResult('Failed to send', true)", context) };
}
test('background rejects settings commands from web content', async () => {
  const { ready, listener, calls } = setup(true);
  await ready;
  assert.equal(listener({ action: 'native', payload: { action: 'getSettings' } }, { tab: { id: 1 } }, () => {}), false);
  assert.equal(calls.length, 0);
});
test('directory prompt queues a link without adding a torrent', async () => {
  const { ready, send, calls, pending, tabs } = setup(true);
  await ready;
  await send({ action: 'captureLink', link: 'magnet:?xt=urn:btih:abc' });
  assert.equal(calls.length, 1); assert.equal(tabs.length, 1);
  assert.equal(pending()[0].link, 'magnet:?xt=urn:btih:abc');
});
test('callback sends use configured directory and paused state', async () => {
  const { ready, send, calls } = setup(false);
  await ready;
  const response = await send({ action: 'captureLink', link: 'https://fosstorrents.com/files/download.php?file=ubuntu-unity-22.04.1.iso.torrent' });
  assert.equal(response.ok, true); assert.equal(calls[1].directory, '/complete'); assert.equal(calls[1].paused, true);
});

test('fetched bytes survive directory prompt and direct add', async () => {
  for (const ask of [true, false]) {
    const { ready, send, calls, pending } = setup(ask);
    await ready;
    await send({ action: 'captureLink', link: 'https://example.com/download', metainfo: 'ZGU=' });
    assert.equal(ask ? pending()[0].metainfo : calls[1].metainfo, 'ZGU=');
  }
});

test('right-click review overrides immediate-send preference', async () => {
  const { ready, send, calls, tabs, pending } = setup(false);
  await ready;
  await send({ action: 'captureLink', link: 'https://example.com/download', metainfo: 'ZGU=', review: true });
  assert.equal(calls.length, 1);
  assert.equal(tabs.length, 1);
  assert.equal(pending()[0].metainfo, 'ZGU=');
});

test('OK badge expires without deleting the latest result; stale timeout preserves a fresh badge', async () => {
  const app = setup(false);
  await app.ready;
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
  await app.ready;
  await app.fail();
  assert.equal(app.badgeTexts.at(-1), '!');
  assert.equal(app.listener({ action: 'clearBadge' }, { url: 'https://example.com', tab: { id: 1 } }, () => {}), false);
  await new Promise(resolve => app.listener({ action: 'clearBadge' }, { url: 'safari-web-extension://test/panel.html' }, resolve));
  assert.equal(app.badgeTexts.at(-1), '');
  assert.equal(app.local.lastResult.failed, true);
  assert.equal(app.local.badgeExpiresAt, undefined);
});

test('click capture follows the native setting and adopts a choice stored before 1.1', async () => {
  const fresh = setup(true);
  await fresh.ready;
  assert.equal(fresh.local.intercept, false, 'off until chosen');
  assert.equal(fresh.saved.length, 0, 'nothing to adopt');
  const legacy = setup(true, { stored: { intercept: true } });
  await legacy.ready;
  assert.equal(JSON.stringify(legacy.saved), '[{"intercept":true}]', 'old storage value moves to the native settings');
  assert.equal(legacy.local.intercept, true);
  const native = setup(true, { native: { intercept: true }, stored: { intercept: false } });
  await native.ready;
  assert.equal(native.local.intercept, true, 'native setting wins over a stale mirror');
  assert.equal(native.saved.length, 0);
  native.local.intercept = undefined;
  const reply = await native.send({ action: 'captureSetting' });
  assert.equal(JSON.stringify(reply), '{"ok":true,"intercept":true}');
  assert.equal(native.local.intercept, true, 'asking refills an empty mirror');
});
test('the context menu is registered once on every background start, and pings are answered at once', async () => {
  const app = setup(true);
  await app.ready;
  assert.deepEqual(app.menus, ['send']);
  let reply;
  assert.equal(app.listener({ action: 'ping' }, { tab: { id: 1 } }, value => { reply = value; }), false);
  assert.equal(JSON.stringify(reply), '{"ok":true}');
  assert.equal(app.listener({ action: 'ping' }, {}, () => {}), false, 'only pages may ping');
});
