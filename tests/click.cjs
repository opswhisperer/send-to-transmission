const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const fs = require('node:fs');
const assert = require('node:assert/strict');
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const window_requests = [];
  await page.clock.install();
  await page.addInitScript(() => {
    const attach = Element.prototype.attachShadow;
    Element.prototype.attachShadow = function(options) { return attach.call(this, { ...options, mode: 'open' }); };
  });
  await page.route('https://test.invalid/**', route => {
    const { pathname } = new URL(route.request().url());
    window_requests.push(pathname);
    if (pathname === '/fetch0') return route.fulfill({ contentType: 'application/x-bittorrent', body: 'd4:infod4:name4:demoee' });
    if (pathname === '/torrent/details') return route.fulfill({ contentType: 'text/html', body: '<p id="details">Torrent details</p>' });
    return route.fulfill({ contentType: 'text/html', body: '<a id="hinted" href="/fetch0?item=20Example">Torrent Free Downloads</a><a id="page" href="/torrent/details?download=1">Download torrent page</a><a id="plain" href="/fetch0?item=1">Open</a><a id="torrent" href="https://fosstorrents.com/files/download.php?file=ubuntu-unity-22.04.1.iso.torrent"><span>Download torrent</span></a><a id="ordinary" href="#normal">Normal link</a><a id="broken" href="magnet:?dn=broken">Broken magnet</a><a id="lan" href="http://192.168.1.5/file.torrent">LAN torrent</a><svg width="80" height="20"><a id="svg" href="magnet:?xt=urn:btih:abc"><rect width="80" height="20"/></a></svg>' });
  });
  await page.addInitScript(() => {
    window.sent = []; window.settingListener = null;
    window.browser = {
      runtime: { id: "test", onMessage: { addListener(fn) { window.receive = fn; } }, sendMessage: (message, callback) => {
        if (message.action === 'ping') return callback({ ok: true });
        window.sent.push(message);
        if (window.holdReplies) window.release = () => callback({ ok: true, text: 'Added: Test' });
        else setTimeout(() => callback({ ok: true, text: 'Choose a directory in the new tab.' }), 10);
      } },
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
  assert.equal(await page.evaluate(() => window.sent[0].review), false);
  const notice = () => page.evaluate(() => [...document.documentElement.children].map(el => el.shadowRoot?.textContent).filter(Boolean).at(-1) || '');
  // A click is acknowledged at once, before the background page answers; SVG links are captured too.
  await page.evaluate(() => { window.holdReplies = true; });
  await page.locator('#svg rect').click();
  await page.waitForFunction(() => window.sent.length === 2);
  assert.ok((await notice()).includes('Sending…'), 'immediate feedback');
  await page.evaluate(() => { window.holdReplies = false; window.release(); });
  await page.waitForFunction(() => [...document.documentElement.children].some(el => el.shadowRoot?.textContent.includes('Added to Transmission: Test')));
  // Another site's link into the private network is sent for review, never straight to the server.
  await page.locator('#lan').click();
  await page.waitForFunction(() => window.sent.length === 3);
  assert.equal(await page.evaluate(() => window.sent[2].review), true);
  // A magnet link Transmission cannot use is still captured and explained.
  await page.locator('#broken').click();
  await page.getByRole('alert').waitFor();
  assert.ok((await notice()).includes('missing its torrent identifier'));
  assert.equal(await page.evaluate(() => window.sent.length), 3);
  assert.ok(page.url().startsWith('https://test.invalid/'), 'the click never left the page');
  await page.getByRole('button', { name: 'Dismiss notification' }).click();
  assert.equal(JSON.stringify(await page.evaluate(() => new Promise(resolve => window.receive({ action: 'captureStatus' }, { id: 'test' }, resolve)))), '{"ok":true,"enabled":true}');
  await page.evaluate(() => { window.sent.length = 1; });
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
  // A same-site link that calls itself a torrent download, at an address with no .torrent in it, is fetched
  // with the page's session and sent when the reply is a torrent.
  await page.goto('https://test.invalid/');
  await page.locator('#hinted').click();
  await page.waitForFunction(() => window.sent.length === 1);
  const fetched = await page.evaluate(() => window.sent[0]);
  assert.equal(fetched.metainfo, Buffer.from('d4:infod4:name4:demoee').toString('base64'));
  assert.equal(fetched.review, false);
  assert.equal(page.url(), 'https://test.invalid/');
  // The same address behind a link that does not say so is left to the browser (here: a download).
  window_requests.length = 0;
  await Promise.all([page.waitForEvent('download'), page.locator('#plain').click()]);
  assert.equal(await page.evaluate(() => window.sent.length), 1);
  assert.equal(window_requests.filter(path => path === '/fetch0').length, 1, 'no extra request for unhinted links');
  // A link that only sounds like a torrent download gets its click back and navigates as usual.
  await page.locator('#page').click();
  await page.locator('#details').waitFor();
  assert.equal(page.url(), 'https://test.invalid/torrent/details?download=1');
  await browser.close();
  console.log('PASS: extensionless same-site torrent download, fallback navigation, trusted click on FOSS Torrents query URL, nested element, SVG link, immediate notice, private-network review, malformed magnet, async callback, ordinary link, disabled capture');
})().catch(error => { console.error(error); process.exit(1); });
