// AI Sprite Studio — run-mode selection
//
// Local mode talks to server.mjs (/api/*, assets/*). Any other host serves a
// static copy of this directory with no API, so it defaults to the read-only
// procedural demo. A loopback host defaults to local mode; `?mode=local` opts in
// explicitly, e.g. for server.mjs bound to a LAN address.
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * Decide whether the editor runs against the local dev server or as a static demo.
 * @param {{ hostname: string, search: string }} location  Usually `window.location`.
 * @returns {'local'|'static'} `?mode=static` or `?mode=local` wins; otherwise
 *   'local' only on a loopback host.
 */
export function resolveStudioMode({ hostname, search }) {
  const requested = new URLSearchParams(search).get('mode');
  if (requested === 'static' || requested === 'local') return requested;
  return LOOPBACK_HOSTS.has(hostname) ? 'local' : 'static';
}
