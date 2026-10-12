// Application chrome: theme, navigation state, status indicator and the
// global action buttons. This is the one place that knows about the status
// dot, the FAB and the top bar, so pages only publish data through events.
import { qs, qsa, setText } from '../dom.js';
import { state, onEvent, emit } from '../store.js';
import { T, toggleLang, getLang } from '../i18n.js';
import { fmtB, fmtDur } from '../format.js';
import { toggleCore } from '../status.js';

const THEME_KEY = 'theme';

/** Apply the persisted theme (the head snippet already did this pre-paint). */
export function initTheme() {
    const dark = localStorage.getItem(THEME_KEY) === 'dark';
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : '');
    setText('thIcon', dark ? 'light_mode' : 'dark_mode');
}

export function toggleTheme(){const d=document.documentElement.getAttribute('data-theme')==='dark';document.documentElement.setAttribute('data-theme',d?'':'dark');document.getElementById('thIcon').textContent=d?'dark_mode':'light_mode';localStorage.setItem('theme',d?'light':'dark');}

/** Highlight the sidebar and bottom-nav entry for `name`. */
export function setActiveNav(name) {
    qsa('.snav a, .bi').forEach((el) => {
        el.classList.toggle('on', el.dataset.page === name);
    });
}

/** Reflect a /api/status payload in the chrome and the dashboard read-outs. */
export function renderStatus(status) {
    const running = !!(status && status.running);
    const dot = qs('sDot');
    if (dot) dot.classList.toggle('on', running);
    setText('sText', running ? T('s.on') : T('s.off'));
    setText('fabIc', running ? 'stop' : 'play_arrow');

    if (status && status.ports) {
        setText('proxyPort', status.ports.mixed);
        setText('apiPort', status.ports.api);
        setText('httpPort', status.ports.mixed);
        setText('socksPort', status.ports.mixed);
    }
    setText('mem', running && status.memory ? fmtB(status.memory) : '--');
    setText('uptime', running ? fmtDur((status && status.uptime) || 0) : '--');

    const coreLabel = qs('coreD');
    if (coreLabel) {
        coreLabel.textContent = running
            ? getLang() === 'zh' ? '运行中' : 'Running'
            : getLang() === 'zh' ? '已停止' : 'Stopped';
    }
}

/** Reflect the Windows system-proxy state in the settings page. */
export function renderSystemProxy(enabled) {
    if (enabled === null || enabled === undefined) {
        setText('sysPSt', '--');
        return;
    }
    const zh = getLang() === 'zh';
    setText('sysPSt', enabled ? (zh ? '开启' : 'ON') : zh ? '关闭' : 'OFF');
}

/** Wire the global buttons and subscribe to the events they depend on. */
export function initChrome() {
    initTheme();

    document.addEventListener('click', (event) => {
        const button = event.target.closest('[data-action]');
        if (!button) return;
        switch (button.dataset.action) {
            case 'toggle-lang':
                toggleLang();
                break;
            case 'toggle-theme':
                toggleTheme();
                break;
            case 'refresh':
                emit('refresh');
                break;
            case 'toggle-core':
                toggleCore();
                break;
            default:
                return;
        }
        event.preventDefault();
    });

    onEvent('status', renderStatus);
    onEvent('system-proxy', renderSystemProxy);
    onEvent('langchange', () => {
        renderStatus(state.status);
        renderSystemProxy(state.systemProxy);
    });
}
