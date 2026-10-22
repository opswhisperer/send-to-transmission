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
  $('defaultDirectory').value = settings.directory; $('destination').value = settings.directory;
  $('sendPaused').checked = settings.paused; $('login').hidden = !settings.auth;
  $('passwordHint').textContent = hasPassword ? 'Password saved in Keychain. Leave blank to keep it; disable login to delete it.' : 'Stored in macOS Keychain.';
  $('directories').replaceChildren(...settings.recentDirectories.map(value => { const option = document.createElement('option'); option.value = value; return option; }));
}
async function save() {
  if (!$('settingsForm').reportValidity()) throw new Error('Check the connection settings.');
  const settings = { host: $('host').value.trim(), port: Number($('port').value), path: $('path').value.trim(), username: $('username').value, directory: $('defaultDirectory').value.trim() };
  for (const id of ['ssl', 'auth', 'paused']) settings[id] = $(id).checked;
  const normalized = TransmissionCore.normalizeServer(settings);
  const result = await native({ action: 'saveSettings', settings: normalized, password: $('password').value });
  await browser.storage.local.set({ intercept: $('intercept').checked });
  $('password').value = ''; populate(result.settings, result.hasPassword);
  return result;
}
$('sendTab').onclick = () => tab(false); $('settingsTab').onclick = () => tab(true);
$('helpTab').onclick = () => tab('help');
$('auth').onchange = () => { $('login').hidden = !$('auth').checked; };
$('settingsForm').onsubmit = event => { event.preventDefault(); busy(event.submitter, async () => { await save(); status('Settings saved.'); }); };
$('test').onclick = () => busy($('test'), async () => { await save(); status('Connecting…'); const result = await native({ action: 'test' }); status(result.text); });
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
  const local = await browser.storage.local.get(null); $('intercept').checked = local.intercept === true;
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
