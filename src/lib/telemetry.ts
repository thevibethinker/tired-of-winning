/** Anonymous visit counting: a random per-browser ID, device class and referring site.
 *  No handles, IP addresses, cookies or third-party trackers. Global Privacy Control opts out. */
export type TrackKind = 'view' | 'ping' | 'sound_on' | 'sound_off' | 'chat_open' | 'map_open' | 'soundboard_open';

const optedOut = () => (navigator as unknown as { globalPrivacyControl?: boolean }).globalPrivacyControl === true;
let visitor = '';
function visitorId() {
  if (visitor) return visitor;
  const fresh = crypto.randomUUID().replace(/-/g, '');
  try { visitor = localStorage.getItem('tow_visitor') || ''; if (!/^[a-f0-9]{32}$/.test(visitor)) { visitor = fresh; localStorage.setItem('tow_visitor', visitor); } }
  catch { visitor = fresh; }
  return visitor;
}
const device = () => window.innerWidth < 600 ? 'phone' : window.innerWidth < 1024 ? 'tablet' : 'desktop';
function via() {
  const tag = new URLSearchParams(location.search).get('via')?.toLowerCase() ?? '';
  if (/^[a-z0-9-]{1,16}$/.test(tag)) return 'via:' + tag;
  try {
    const host = document.referrer ? new URL(document.referrer).hostname.replace(/^(www|l|lm|m|mobile)\./, '') : '';
    return host && host !== location.hostname ? host.slice(0, 60) : '(direct)';
  } catch { return '(direct)'; }
}
const source = via();

export function track(kind: TrackKind) {
  if (optedOut()) return;
  try {
    void fetch('/api/t', { method: 'POST', keepalive: true, credentials: 'omit', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ visitor: visitorId(), kind, device: device(), via: source }) }).catch(() => {});
  } catch { /* counting never blocks the page */ }
}

let started = false;
export function startTelemetry() {
  if (started) return;
  started = true;
  track('view');
  setInterval(() => { if (document.visibilityState === 'visible') track('ping'); }, 60_000);
}
