// Focus inside any of these keeps its native keyboard behaviour (Space activates
// a button, toggles a <summary>, opens a <select>, types into a field).
const INTERACTIVE = 'button, select, summary, a, input, textarea, [contenteditable]:not([contenteditable="false"])';

/**
 * Whether a key event target is, or sits inside, a control that owns its keys.
 * @param {EventTarget|null} target
 * @returns {boolean}
 */
function isInteractiveTarget(target) {
  return typeof target?.closest === 'function' && target.closest(INTERACTIVE) !== null;
}

/**
 * Setup and initialize document keyboard event listeners.
 * @param {object} initialFsm - initial FSM state machine instance.
 * @param {function} highlightKeyCallback - callback (key, on) to highlight keys in the DOM UI.
 * @returns {object} keyboard handler controller.
 */
export function initKeyboard(initialFsm, highlightKeyCallback) {
  let fsm = initialFsm;
  const KEY_EVENTS = {
    w: ['MOVE_UP', 'MOVE'],
    a: ['MOVE_LEFT', 'MOVE'],
    s: ['MOVE_DOWN', 'MOVE'],
    d: ['MOVE_RIGHT', 'MOVE'],
  };
  const held = new Set();

  function sendFirstHandled(candidates) {
    if (!fsm) return;
    for (const ev of candidates) {
      if (fsm.can(ev)) {
        fsm.send(ev);
        return;
      }
    }
  }

  const onKeyDown = (e) => {
    if (isInteractiveTarget(e.target)) return;
    const k = e.key.toLowerCase();
    if (k !== ' ' && !KEY_EVENTS[k]) return;
    if (k === ' ') e.preventDefault(); // also on auto-repeat, so Space never scrolls a panel
    if (held.has(k)) return;
    held.add(k);
    highlightKeyCallback(k, true);
    if (k === ' ') sendFirstHandled(['ATTACK', 'DAMAGE']);
    else sendFirstHandled(KEY_EVENTS[k]);
  };

  const onKeyUp = (e) => {
    const k = e.key.toLowerCase();
    // Only release keys whose keydown was handled, so typing "d" in a field never sends STOP.
    if (!held.delete(k)) return;
    highlightKeyCallback(k, false);
    if (KEY_EVENTS[k] && !['w', 'a', 's', 'd'].some((m) => held.has(m))) {
      sendFirstHandled(['STOP']);
    }
  };

  document.addEventListener('keydown', onKeyDown);
  document.addEventListener('keyup', onKeyUp);

  return {
    destroy: () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('keyup', onKeyUp);
    },
    updateFsm: (newFsm) => {
      fsm = newFsm;
    }
  };
}
