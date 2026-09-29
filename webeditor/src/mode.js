// AI Sprite Studio — run-mode selection
//
// Local mode talks to server.mjs (/api/*, assets/*). Any other host serves a
// static copy of this directory with no API, so it must run the read-only
// procedural demo. Only a loopback host may opt into local mode.
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * Decide whether the editor runs against the local dev server or as a static demo.
 * @param {{ hostname: string, search: string }} location  Usually `window.location`.
 * @returns {'local'|'static'} 'local' only on a loopback host without `?mode=static`.
 */
export function resolveStudioMode({ hostname, search }) {
  if (new URLSearchParams(search).get('mode') === 'static') return 'static';
  return LOOPBACK_HOSTS.has(hostname) ? 'local' : 'static';
}
