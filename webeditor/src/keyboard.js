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
    if (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT') return;
    const k = e.key.toLowerCase();
    if (held.has(k)) return;
    held.add(k);
    highlightKeyCallback(k, true);
    if (k === ' ') {
      e.preventDefault();
      sendFirstHandled(['ATTACK', 'DAMAGE']);
    } else if (KEY_EVENTS[k]) {
      sendFirstHandled(KEY_EVENTS[k]);
    }
  };

  const onKeyUp = (e) => {
    const k = e.key.toLowerCase();
    held.delete(k);
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
