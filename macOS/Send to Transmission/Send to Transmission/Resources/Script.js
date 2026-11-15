const $ = id => document.getElementById(id);
const post = (action, extra = {}) => webkit.messageHandlers.controller.postMessage({ action, ...extra });

function status(text, failed = false) {
    $('status').textContent = text;
    $('status').classList.toggle('error', failed);
}

function buttons(shown) {
    for (const id of ['retry', 'skip', 'done']) $(id).hidden = !shown.includes(id);
}

// Events sent by ViewController.swift.
const events = {
    extension({ enabled, modern }) {
        if (modern) {
            document.getElementsByClassName('state-on')[0].innerText = "Send to Transmission’s extension is currently on. You can turn it off in the Extensions section of Safari Settings.";
            document.getElementsByClassName('state-off')[0].innerText = "Send to Transmission’s extension is currently off. You can turn it on in the Extensions section of Safari Settings.";
            document.getElementsByClassName('state-unknown')[0].innerText = "You can turn on Send to Transmission’s extension in the Extensions section of Safari Settings.";
            document.getElementsByClassName('open-preferences')[0].innerText = "Quit and Open Safari Settings…";
        }
        document.body.classList.toggle('state-on', enabled === true);
        document.body.classList.toggle('state-off', enabled === false);
    },
    handler({ isDefault, current, error }) {
        $('handlerText').textContent = error ? 'Could not change the magnet link app: ' + error
            : isDefault ? 'Magnet links clicked anywhere on this Mac open in Send to Transmission.'
            : current ? 'Magnet links currently open in ' + current + '.'
            : 'No app is set to open magnet links.';
        $('handlerText').classList.toggle('error', !!error);
        $('makeDefault').hidden = isDefault;
    },
    begin({ name, remaining }) {
        document.body.classList.add('sending');
        $('name').textContent = name;
        $('more').textContent = remaining ? remaining + ' more waiting' : '';
        $('review').hidden = true;
        buttons([]);
        status('Preparing…');
    },
    review({ directory, paused, recent }) {
        $('directory').value = directory;
        $('paused').checked = paused;
        $('remember').checked = false;
        $('recent').replaceChildren(...recent.map(value => { const option = document.createElement('option'); option.value = value; return option; }));
        $('review').hidden = false;
        status('');
        $('directory').focus();
    },
    status({ text }) {
        $('review').hidden = true;
        status(text);
    },
    result({ text, failed, remaining, closing }) {
        $('review').hidden = true;
        $('more').textContent = remaining ? remaining + ' more waiting' : '';
        status(text + (closing ? '\nThis window will close.' : ''), failed);
        buttons(closing ? [] : failed ? ['retry', remaining ? 'skip' : 'done'] : remaining ? [] : ['done']);
    },
    idle() {
        document.body.classList.remove('sending');
    }
};

function receive({ event, payload }) {
    events[event]?.(payload);
}

$('review').addEventListener('submit', event => {
    event.preventDefault();
    post('send', { directory: $('directory').value.trim(), paused: $('paused').checked, remember: $('remember').checked });
});
for (const id of ['cancel', 'retry', 'skip', 'done']) $(id).addEventListener('click', () => post(id));
$('makeDefault').addEventListener('click', () => post('make-default'));
document.querySelector('button.open-preferences').addEventListener('click', () => post('open-preferences'));
