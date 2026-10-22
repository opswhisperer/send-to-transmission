async function native(message) {
  return TransmissionCore.requestNative(browser, message);
}
const badgeAlarm = 'clear-result-badge';
let badgeTimer;
let badgeQueue = Promise.resolve();
function badgeOperation(operation) {
  const result = badgeQueue.then(operation);
  badgeQueue = result.catch(() => {});
  return result;
}
async function clearBadgeState() {
  clearTimeout(badgeTimer);
  await browser.alarms.clear(badgeAlarm);
  await browser.storage.local.remove('badgeExpiresAt');
  await browser.action.setBadgeText({ text: '' });
  await browser.action.setTitle({ title: 'Send to Transmission' });
}
function clearBadge() { return badgeOperation(clearBadgeState); }
function expireBadge() {
  return badgeOperation(async () => {
    const { badgeExpiresAt } = await browser.storage.local.get('badgeExpiresAt');
    // An older timeout must not clear the badge for a newer send.
    if (!badgeExpiresAt || badgeExpiresAt <= Date.now()) await clearBadgeState();
  });
}
browser.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === badgeAlarm) expireBadge().catch(() => {});
});
function rememberResult(result, failed = false) {
  return badgeOperation(async () => {
    const now = Date.now();
    await browser.storage.local.set({ lastResult: { text: result, failed, time: now }, badgeExpiresAt: now + 30000 });
    await browser.action.setBadgeText({ text: failed ? '!' : 'OK' });
    await browser.action.setTitle({ title: result });
    clearTimeout(badgeTimer);
    // The alarm survives background suspension; the timer handles an awake background.
    await browser.alarms.create(badgeAlarm, { when: now + 30000 });
    badgeTimer = setTimeout(() => expireBadge().catch(() => {}), 30000);
  });
}
async function sendLink(link, metainfo, review = false) {
  if (metainfo !== undefined && (typeof metainfo !== "string" || metainfo.length > 2796204)) throw new Error("Invalid torrent data.");
  link = TransmissionCore.validateLink(link);
  const { settings } = await native({ action: 'getSettings' });
  if (review || settings.askDirectory || !settings.host) {
    const id = crypto.randomUUID();
    await browser.storage.local.set({ ['pending:' + id]: { link, ...(metainfo ? { metainfo } : {}), time: Date.now() } });
    await browser.tabs.create({ url: browser.runtime.getURL('panel.html') + '?pending=' + id });
    return { text: 'Choose a download directory in the new tab.' };
  }
  const result = await native({ action: 'add', link, ...(metainfo ? { metainfo } : {}), directory: settings.directory, paused: settings.paused });
  await rememberResult(result.text);
  return result;
}
function registerMenu() {
  // Callback sequencing ensures removal has finished before creation in Safari.
  browser.contextMenus.removeAll(() => {
    if (browser.runtime.lastError) return;
    browser.contextMenus.create({ id: 'send', title: 'Send to Transmission', contexts: ['link'] });
  });
}
browser.runtime.onInstalled.addListener(registerMenu);
browser.runtime.onStartup.addListener(registerMenu);
browser.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== 'send') return;
  try {
    if (info.linkUrl.startsWith('magnet:')) await sendLink(info.linkUrl, undefined, true);
    else {
      if (tab?.id == null) throw new Error('Open the download page in a Safari tab first.');
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('The download page did not respond within 60 seconds. Reload it and try again.')), 60000);
        browser.tabs.sendMessage(tab.id, { action: 'fetchTorrentLink', link: info.linkUrl }, { frameId: info.frameId ?? 0 }, reply => {
          clearTimeout(timer);
          if (browser.runtime.lastError) reject(new Error('Could not contact the download page: ' + browser.runtime.lastError.message + ' Reload the page after updating; check Safari website access if this persists.'));
          else if (!reply) reject(new Error('The download page returned no reply. Reload it after updating the extension.'));
          else if (!reply.ok) reject(new Error(reply.error));
          else resolve(reply);
        });
      });
    }
  }
  catch (error) {
    await rememberResult(error.message, true);
    await browser.tabs.create({ url: browser.runtime.getURL('panel.html') });
  }
});
browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'clearBadge' && sender.url?.split('?')[0] === browser.runtime.getURL('panel.html')) {
    clearBadge().then(() => sendResponse({ ok: true }), error => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message.action !== 'captureLink' || !sender.tab) return false;
  sendLink(message.link, message.metainfo, message.review === true)
    .then(result => sendResponse({ ok: true, text: result.text }))
    .catch(async error => {
      try { await rememberResult(error.message, true); } catch {}
      sendResponse({ ok: false, error: error.message });
    });
  // Keep Safari's message channel alive while the native request finishes.
  return true;
});
