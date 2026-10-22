const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const fs = require('node:fs');
const assert = require('node:assert/strict');
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.clock.install();
  await page.addInitScript(() => {
    const attach = Element.prototype.attachShadow;
    Element.prototype.attachShadow = function(options) { return attach.call(this, { ...options, mode: 'open' }); };
  });
  await page.route('https://test.invalid/**', route => route.fulfill({ contentType: 'text/html', body: '<a id="torrent" href="https://fosstorrents.com/files/download.php?file=ubuntu-unity-22.04.1.iso.torrent"><span>Download torrent</span></a><a id="ordinary" href="#normal">Normal link</a>' }));
  await page.addInitScript(() => {
    window.sent = []; window.settingListener = null;
    window.browser = {
      runtime: { id: "test", onMessage: { addListener(fn) { window.receive = fn; } }, sendMessage: (message, callback) => { window.sent.push(message); setTimeout(() => callback({ ok: true, text: 'Choose a directory in the new tab.' }), 10); } },
      storage: { local: { get: (_, callback) => callback({ intercept: true }) }, onChanged: { addListener: callback => { window.settingListener = callback; } } }
    };
  });
  await page.addInitScript({ content: fs.readFileSync('Extension/core.js','utf8') + '\n' + fs.readFileSync('Extension/content.js','utf8') });
  await page.goto('https://test.invalid/');
  await page.locator('#torrent span').click();
  await page.waitForFunction(() => window.sent.length === 1);
  assert.equal((await page.evaluate(() => window.sent[0])).link, 'https://fosstorrents.com/files/download.php?file=ubuntu-unity-22.04.1.iso.torrent');
  assert.equal(page.url(), 'https://test.invalid/');
  await page.locator('#ordinary').click();
  assert.equal(await page.evaluate(() => window.sent.length), 1);
  // Disable capture, prevent browser navigation, and confirm the extension does not consume the click.
  await page.evaluate(() => {
    window.settingListener({ intercept: { newValue: false } });
    document.addEventListener('click', event => { window.sawUncaptured = !event.defaultPrevented; event.preventDefault(); });
  });
  await page.locator('#torrent').click();
  assert.equal(await page.evaluate(() => window.sent.length), 1);
  assert.equal(await page.evaluate(() => window.sawUncaptured), true);
  await page.evaluate(() => {
    window.fetchCount = 0;
    TransmissionCore.fetchTorrent = async () => { window.fetchCount++; return { metainfo: 'ZGU=' }; };
  });
  await page.evaluate(() => new Promise(resolve => window.receive({ action: 'fetchTorrentLink', link: 'https://test.invalid/download' }, { id: 'test' }, resolve)));
  assert.equal(await page.evaluate(() => window.fetchCount), 1, 'context menu fetches extensionless link contents');
  assert.equal(await page.evaluate(() => window.sent[1].metainfo), 'ZGU=');
  await page.evaluate(() => new Promise(resolve => window.receive({ action: 'fetchTorrentLink', link: 'https://test.invalid/download' }, {}, resolve)));
  assert.equal(await page.evaluate(() => window.fetchCount), 2, 'internal message does not require optional sender id');
  await page.waitForFunction(() => [...document.querySelectorAll('div')].some(el => el.shadowRoot?.querySelector('[role=status]')));
  assert.equal(await page.getByRole('button', { name: 'Dismiss notification' }).count(), 1);
  await page.screenshot({ path: 'build/toast-success.png' });
  await page.clock.fastForward(10000);
  assert.equal(await page.getByRole('button', { name: 'Dismiss notification' }).count(), 0);
  await page.evaluate(() => { TransmissionCore.fetchTorrent = async () => { throw new Error('Test download failed'); }; });
  await page.evaluate(() => new Promise(resolve => window.receive({ action: 'fetchTorrentLink', link: 'https://test.invalid/download' }, {}, resolve)));
  await page.clock.fastForward(11000);
  assert.equal(await page.getByRole('alert').count(), 1);
  await page.screenshot({ path: 'build/toast-error.png' });
  await page.getByRole('button', { name: 'Dismiss notification' }).click();
  assert.equal(await page.getByRole('alert').count(), 0);
  await browser.close();
  console.log('PASS: trusted click on FOSS Torrents query URL, nested element, async callback, ordinary link, disabled capture');
})().catch(error => { console.error(error); process.exit(1); });
