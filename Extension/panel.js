const $ = id => document.getElementById(id);
const params = new URLSearchParams(location.search);
let pending = params.get('pending');
let pendingMetainfo = null;
// Opening either the popup or send page acknowledges the badge, not the saved result.
browser.runtime.sendMessage({ action: 'clearBadge' }, () => { void browser.runtime.lastError; });
function status(text, error = false) { $('status').textContent = text; $('status').classList.toggle('error', error); }
function tab(selection) {
  const active = selection === true ? 'settings' : selection === false ? 'send' : selection;
  for (const name of ['send', 'settings', 'help']) {
    $(name + 'Section').hidden = name !== active;
    $(name + 'Tab').setAttribute('aria-pressed', String(name === active));
  }
}
function native(payload) { return TransmissionCore.requestNative(browser, payload); }
async function busy(button, operation) {
  const buttons = [...document.querySelectorAll('form button')];
  buttons.forEach(item => { item.disabled = true; });
  try { await operation(); } catch (error) { status(error.message || 'Request failed.', true); }
  finally { buttons.forEach(item => { item.disabled = false; }); }
}
function populate(settings, hasPassword) {
  for (const id of ['host', 'port', 'path', 'username']) $(id).value = settings[id];
  for (const id of ['ssl', 'auth', 'paused']) $(id).checked = settings[id];
  $('sendImmediately').checked = settings.askDirectory === false;
  if (typeof settings.intercept === 'boolean') $('intercept').checked = settings.intercept;
  $('defaultDirectory').value = settings.directory; $('destination').value = settings.directory;
  $('sendPaused').checked = settings.paused; $('login').hidden = !settings.auth;
  $('passwordHint').textContent = hasPassword ? 'Password saved in Keychain. Leave blank to keep it; disable login to delete it.' : 'Stored in macOS Keychain.';
  $('directories').replaceChildren(...settings.recentDirectories.map(value => { const option = document.createElement('option'); option.value = value; return option; }));
}
async function save() {
  if (!$('settingsForm').reportValidity()) throw new Error('Check the connection settings.');
  const settings = { host: $('host').value.trim(), port: Number($('port').value), path: $('path').value.trim(), username: $('username').value, directory: $('defaultDirectory').value.trim() };
  for (const id of ['ssl', 'auth', 'paused', 'intercept']) settings[id] = $(id).checked;
  const normalized = TransmissionCore.normalizeServer(settings);
  const result = await native({ action: 'saveSettings', settings: normalized, password: $('password').value });
  await browser.storage.local.set({ intercept: settings.intercept });
  $('password').value = ''; populate(result.settings, result.hasPassword);
  showCapture();
  return result;
}
// Click capture is saved natively (it survives reinstalls and covers every Safari profile) and mirrored into
// storage.local, where content scripts read it.
async function setCapture(value) {
  await native({ action: 'saveSettings', settings: { intercept: value } });
  await browser.storage.local.set({ intercept: value });
  $('intercept').checked = value;
  showCapture();
}
// Only the toolbar popup sits over a web page; the send, settings and result tabs have nothing to report on.
let pageTab = null;
async function pageState() {
  if (params.has('pending') || params.has('settings') || !browser.tabs?.query) return null;
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (!tab || tab.url?.startsWith(location.origin)) return null;
  pageTab = tab;
  const live = await new Promise(resolve => {
    const timer = setTimeout(() => resolve(false), 1000);
    try {
      browser.tabs.sendMessage(tab.id, { action: 'captureStatus' }, reply => { clearTimeout(timer); void browser.runtime.lastError; resolve(reply?.ok === true); });
    } catch { clearTimeout(timer); resolve(false); }
  });
  if (live) return 'active';
  // Safari hides a tab's address from extensions that are not allowed on its website.
  if (!tab.url) return 'blocked';
  return /^https?:/.test(tab.url) ? 'reload' : null;
}
let captureAction = null;
async function showCapture() {
  let state = null;
  try { state = await pageState(); } catch {}
  const on = $('intercept').checked;
  const [text, label, action] = !on ? ['Click capture is off, so clicking a magnet or .torrent link will not send it.', 'Turn on', () => setCapture(true)]
    : state === 'active' ? ['Click capture is on and working on this page.']
    : state === 'reload' ? ['Click capture is on, but this page was opened before the extension was ready.', 'Reload page', async () => { await browser.tabs.reload(pageTab.id); window.close(); }]
    : state === 'blocked' ? ['Click capture is on, but Safari has not allowed the extension on this page.', 'Allow websites', allowWebsites]
    : ['Click capture is on.'];
  $('capture').hidden = !pageTab;
  $('captureText').textContent = text;
  $('captureButton').hidden = !label; $('captureButton').textContent = label || '';
  captureAction = action || null;
}
async function allowWebsites() {
  let granted = false;
  try { granted = await browser.permissions.request({ origins: ['http://*/*', 'https://*/*'] }); } catch {}
  if (!granted) throw new Error('Allow it in Safari: click the Send to Transmission toolbar button’s permission prompt, or open Safari Settings → Extensions → Send to Transmission and allow the websites you use. Then reload the page.');
  if (pageTab) await browser.tabs.reload(pageTab.id);
  window.close();
}
$('captureButton').onclick = () => busy($('captureButton'), async () => { await captureAction?.(); });
$('intercept').onchange = () => {
  const value = $('intercept').checked;
  busy($('intercept'), async () => {
    try { await setCapture(value); } catch (error) { $('intercept').checked = !value; throw error; }
    status(value ? 'Click capture turned on.' : 'Click capture turned off.');
  });
};
$('sendTab').onclick = () => tab(false); $('settingsTab').onclick = () => tab(true);
$('helpTab').onclick = () => tab('help');
$('auth').onchange = () => { $('login').hidden = !$('auth').checked; };
const passwordRemoved = 'The saved password was removed because the server or username changed. Enter it again.';
$('settingsForm').onsubmit = event => { event.preventDefault(); busy(event.submitter, async () => { const saved = await save(); status(saved.passwordCleared ? 'Settings saved. ' + passwordRemoved : 'Settings saved.', saved.passwordCleared === true); }); };
$('test').onclick = () => busy($('test'), async () => { if ((await save()).passwordCleared) throw new Error(passwordRemoved); status('Connecting…'); const result = await native({ action: 'test' }); status(result.text); });
$('sendForm').onsubmit = event => {
  event.preventDefault();
  busy($('sendButton'), async () => {
    const link = TransmissionCore.validateLink($('link').value);
    status('Sending…');
    const result = await native({ action: 'add', link, ...(pendingMetainfo ? { metainfo: pendingMetainfo } : {}), directory: $('destination').value.trim(), paused: $('sendPaused').checked });
    await native({ action: 'saveSettings', settings: { askDirectory: !$('sendImmediately').checked } });
    status(result.text); await browser.storage.local.set({ lastResult: { text: result.text, time: Date.now() } });
    if (pending) { await browser.storage.local.remove('pending:' + pending); pending = null; history.replaceState(null, '', location.pathname); }
  });
};
(async () => {
  const result = await native({ action: 'getSettings' }); populate(result.settings, result.hasPassword);
  const local = await browser.storage.local.get(null);
  // Until the background page has adopted a choice made before 1.1, storage.local still holds it.
  const intercept = typeof result.settings.intercept === 'boolean' ? result.settings.intercept : local.intercept === true;
  $('intercept').checked = intercept;
  if (local.intercept !== intercept) await browser.storage.local.set({ intercept });
  showCapture();
  tab(params.has('settings') || !result.settings.host);
  if (pending && local['pending:' + pending] && Date.now() - local['pending:' + pending].time <= 86400000) {
    $('link').value = local['pending:' + pending].link;
    pendingMetainfo = local['pending:' + pending].metainfo || null;
    $('link').readOnly = !!pendingMetainfo;
    if (pendingMetainfo) status('Torrent file fetched using Safari. Choose its destination.');
  }
  else if (local.lastResult) status(local.lastResult.text + ' · ' + new Date(local.lastResult.time).toLocaleString(), local.lastResult.failed === true);
  const expired = Object.keys(local).filter(key => key.startsWith('pending:') && Date.now() - local[key].time > 86400000);
  if (expired.length) await browser.storage.local.remove(expired);
})().catch(error => status(error.message, true));
