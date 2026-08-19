// AI Sprite Studio — FSM driver (aifsmjs)
//
// Builds a real aifsmjs runtime from the atlas `states` block so state preview
// is driven by the same deterministic machine a game would ship — not an ad-hoc
// switch. Movement keys / buttons `send()` events; the runtime decides the next
// state; we react to `subscribe()` by playing that state's animation.
//
// Object/icon atlases have no FSM — the editor plays their animations directly.
import { createMachine } from 'aifsmjs';

// A synthetic event fired when a non-looping animation finishes, so a state with
// `onEnd: "<stateName>"` (e.g. attack → idle) can transition on completion.
export const ANIM_END = 'ANIM_END';

/**
 * Translate atlas `states.definitions` into an aifsmjs MachineDef and start it.
 * @param {any} atlas
 * @param {(stateName: string) => void} onState  Called with the current state on every change.
 * @param {string} [initialState]  Seed the runtime here instead of the atlas `initial` (lets the
 *                                 editor jump straight to any state for inspection).
 * @returns {{ send: (type: string) => void, current: () => string, can: (type:string)=>boolean, dispose: () => void } | null}
 */
export function startFsm(atlas, onState, initialState) {
  const def = atlas.states;
  if (!def?.definitions || Object.keys(def.definitions).length === 0) return null;

  const states = {};
  for (const [name, sdef] of Object.entries(def.definitions)) {
    /** @type {Record<string, {target:string}>} */
    const on = {};
    for (const [evt, trans] of Object.entries(sdef.transitions || {})) {
      if (trans?.target) on[evt] = { target: trans.target };
    }
    // A state whose `onEnd` names another state transitions there when the clip ends.
    if (sdef.onEnd && sdef.onEnd !== 'loop' && sdef.onEnd !== 'hold' && def.definitions[sdef.onEnd]) {
      on[ANIM_END] = { target: sdef.onEnd };
    }
    states[name] = { on };
  }

  const initial = initialState && states[initialState]
    ? initialState
    : def.initial && states[def.initial] ? def.initial : Object.keys(states)[0];

  const runtime = createMachine(
    { id: 'aisprite-studio-sprite', initial, context: {}, states },
    {}, // no guards/actions/effects — pure animation routing
  );

  const unsub = runtime.subscribe((snap) => onState(snap.value));
  onState(runtime.getSnapshot().value); // fire once for the initial state

  return {
    send: (type) => {
      // Ignore events the current state doesn't handle, so stray key presses are harmless.
      if (runtime.can({ type })) runtime.send({ type });
    },
    current: () => runtime.getSnapshot().value,
    can: (type) => runtime.can({ type }),
    dispose: () => {
      unsub();
      runtime.dispose();
    },
  };
}
