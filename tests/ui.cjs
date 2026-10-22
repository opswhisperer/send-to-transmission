const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const assert = require('node:assert/strict');
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 440, height: 980 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    let settings = { host: 'transmission.example.com', port: 443, ssl: true, path: '/transmission/rpc', auth: false, username: '', directory: '', paused: false, askDirectory: true, recentDirectories: ['/complete', '/complete/linux'] };
    const local = {}; window.testCalls = [];
    window.browser = {
      runtime: { sendMessage: (payload, callback) => { window.badgeAcknowledged = payload.action === 'clearBadge'; callback({ ok: true }); }, sendNativeMessage: (_, payload, callback) => {
        if (window.nativeFailure === "missing") return callback(undefined);
        if (window.nativeFailure === "validation") return callback({ ok: false, error: "Enter a valid server address." });
        window.testCalls.push(payload);
        if (payload.action === 'saveSettings') settings = { ...settings, ...payload.settings };
        if (payload.action === 'test') return callback({ ok: true, text: 'Connected to Transmission 4.1.3.\nServer default directory: /complete' });
        if (payload.action === 'add') return callback({ ok: true, text: 'Added paused: Example Linux' });
        return callback({ ok: true, settings, hasPassword: false });
      } },
      storage: { local: { get: async () => local, set: async values => Object.assign(local, values), remove: async () => {} } }
    };
  });
  await page.goto(pathToFileURL(path.resolve('Extension/panel.html')).href);
  await page.locator('#destination').waitFor();
  assert.equal(await page.evaluate(() => window.badgeAcknowledged), true);
  await page.locator('#link').fill('magnet:?xt=urn:btih:0123456789012345678901234567890123456789');
  await page.locator('#destination').fill('/complete/linux');
  await page.locator('#sendPaused').check();
  await page.locator('#sendImmediately').check();
  await page.locator('#sendButton').click();
  await page.waitForFunction(() => document.querySelector('#status').textContent.includes('Added paused'));
  const call = await page.evaluate(() => window.testCalls.find(x => x.action === 'add'));
  assert.equal(call.directory, '/complete/linux'); assert.equal(call.paused, true);
  assert.equal(await page.evaluate(() => window.testCalls.find(x => x.action === 'saveSettings').settings.askDirectory), false);
  await page.locator('#helpTab').click();
  assert.equal(await page.locator('#helpSection').isVisible(), true);
  assert.equal(await page.locator('#sendSection').isVisible(), false);
  await page.locator('#sendTab').click();
  await page.screenshot({ path: 'build/send-panel.png', fullPage: true });
  await page.locator('#settingsTab').click();
  await page.locator('#host').fill('https://transmission.example.com');
  await page.locator('#auth').check();
  await page.locator('#username').fill('test');
  await page.locator('#password').fill('example-only');
  await page.locator('#test').click();
  await page.waitForFunction(() => document.querySelector('#status').textContent.includes('Connected'));
  assert.equal(await page.locator('#password').inputValue(), '');
  assert.equal(await page.locator('#ssl').isChecked(), true);
  assert.equal(await page.locator('#port').inputValue(), '443');
  assert.equal(await page.locator('#host').inputValue(), 'transmission.example.com');
  await page.screenshot({ path: 'build/settings-panel.png', fullPage: true });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.screenshot({ path: 'build/settings-dark.png', fullPage: true });
  for (const failure of ['missing', 'validation']) {
    await page.evaluate(value => { window.nativeFailure = value; }, failure);
    await page.locator('#test').click();
    await page.waitForFunction(() => document.querySelector('#status').classList.contains('error'));
    assert.ok(!(await page.locator('#status').textContent()).includes('undefined'));
    assert.equal(await page.locator('#test').isEnabled(), true);
  }
  assert.deepEqual(errors, []);
  await browser.close();
  console.log('PASS: popup send, directory/paused payload, settings, test, password clearing, light/dark render (mock native bridge)');
})().catch(error => { console.error(error); process.exit(1); });
