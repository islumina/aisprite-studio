// AI Sprite Studio — preview runtime over the aispritejs animator
//
// Every atlas plays through one aispritejs SpriteAnimator, which is also the
// playback clock: tick(dt) advances it, the preview shows its active frame, and
// its own onEnd handling moves a finished one-shot clip to its return state.
// An atlas with an input-driven control block (inputs/states/transitions) uses
// it as-is; an animations-only atlas (objects, effects) gets a synthesised block
// with one state per animation, so loop/hold/return behave the same everywhere.
import { createSpriteAnimator } from 'aispritejs';
import { parseAtlas } from 'aispritejs/atlas';
import { getUnits, hasControlBlock } from './atlas-model.js';
import { DEFAULT_FRAME_DURATION_MS } from './constants.js';

// Words that mark a Number input as the movement speed WASD drives.
const MOVE_INPUT_WORDS = ['speed', 'velocity', 'move'];

/**
 * Keyboard bindings a graph supports: the Number input WASD sets to 1 (0 on
 * release) and the Trigger input Space fires. The trigger is the first declared
 * `trigger` input, whatever its name.
 * @param {{ inputs?: Record<string, { type?: string }> }} graph
 * @returns {{ move: string|null, trigger: string|null }}
 */
export function previewControls(graph) {
  const entries = Object.entries(graph?.inputs ?? {});
  const move = entries.find(([name, def]) => (
    def?.type === 'number' && MOVE_INPUT_WORDS.some((word) => name.toLowerCase().includes(word))
  ));
  const trigger = entries.find(([, def]) => def?.type === 'trigger');
  return { move: move?.[0] ?? null, trigger: trigger?.[0] ?? null };
}

/** Control block for an atlas without one: each playable unit becomes a state. */
function unitControl(atlas) {
  const units = getUnits(atlas);
  const names = new Set(units.map((unit) => unit.name));
  const states = {};
  for (const unit of units) {
    const returns = unit.onEnd !== 'loop' && unit.onEnd !== 'hold' && names.has(unit.onEnd);
    states[unit.name] = {
      animation: unit.animation,
      loop: unit.onEnd === 'loop',
      ...(returns ? { onEnd: unit.onEnd } : {}),
    };
  }
  return { inputs: {}, states, transitions: [] };
}

/**
 * The aispritejs graph the preview plays. Throws InvalidAtlasError /
 * InvalidGraphError (with the library's message) for a malformed control block,
 * including the removed `states.definitions` shape.
 * @param {any} atlas
 * @returns {import('aispritejs').SpriteGraph}
 */
export function toSpriteGraph(atlas) {
  const graph = hasControlBlock(atlas) ? parseAtlas(atlas) : parseAtlas(atlas, unitControl(atlas));
  // Same fallback as the editor's duration display (atlas-model.js), instead of aispritejs's 100 ms.
  return { ...graph, defaultFrameDuration: graph.defaultFrameDuration ?? DEFAULT_FRAME_DURATION_MS };
}

/** Fail fast on an atlas the preview cannot play; builds and discards an animator. */
export function validateAtlas(atlas) {
  createSpriteAnimator(toSpriteGraph(atlas)).dispose();
}

/** A pinned state loops until a trigger fires, so its own onEnd is dropped (aispritejs rejects onEnd with loop). */
function pinnedState({ animation, speed }) {
  return { animation, loop: true, ...(speed !== undefined ? { speed } : {}) };
}

/**
 * Start the preview runtime.
 *
 * Preview lock: `loopState` names the state the artist picked while the lock is
 * on. That state loops for inspection even if the graph plays it once. Firing a
 * trigger releases the pin for good, so the trigger's clip plays once and returns
 * per the graph (Space in a locked idle plays `hit` once, then idle again).
 *
 * @param {any} atlas  A normalised atlas.
 * @param {{ onState?: (state: string) => void, initialState?: string, loopState?: string|null }} [options]
 *   `onState` runs for the start state and on every state change.
 * @returns {{
 *   controls: { move: string|null, trigger: string|null },
 *   readonly state: string, readonly frameIndex: number,
 *   tick: (deltaMs: number) => void, can: (command: string) => boolean,
 *   send: (command: string) => void, dispose: () => void,
 * } | null}  null when the atlas has nothing to play.
 */
export function createPreviewRuntime(atlas, { onState, initialState, loopState = null } = {}) {
  if (getUnits(atlas).length === 0) return null;
  const graph = toSpriteGraph(atlas);
  const controls = previewControls(graph);
  const inputs = new Map(); // Number/Boolean values set so far, replayed when the animator is rebuilt
  let pinned = loopState && graph.states[loopState] ? loopState : null;
  let animator = null;
  let unsubscribe = () => {};

  function build(startState) {
    unsubscribe();
    animator?.dispose();
    const states = pinned ? { ...graph.states, [pinned]: pinnedState(graph.states[pinned]) } : graph.states;
    const initial = startState && graph.states[startState] ? startState : graph.initial;
    animator = createSpriteAnimator({ ...graph, states, ...(initial !== undefined ? { initial } : {}) });
    for (const [name, value] of inputs) animator.setInput(name, value);
    unsubscribe = animator.onStateChange((to) => onState?.(to));
  }

  /** Map a keyboard command (keyboard.js) onto this graph's inputs. */
  function commandTarget(command) {
    if (command === 'STOP') return controls.move ? { input: controls.move, value: 0 } : null;
    if (command === 'MOVE' || command.startsWith('MOVE_')) {
      return controls.move ? { input: controls.move, value: 1 } : null;
    }
    if (command === 'ATTACK' || command === 'DAMAGE') return controls.trigger ? { trigger: controls.trigger } : null;
    return null;
  }

  build(initialState);
  onState?.(animator.activeState);

  return {
    controls,
    get state() { return animator.activeState; },
    get frameIndex() { return animator.activeFrameIndex; },
    tick(deltaMs) { animator.update(deltaMs); },
    can: (command) => commandTarget(command) !== null,
    send(command) {
      const target = commandTarget(command);
      if (!target) return;
      if (target.trigger) {
        if (pinned) {
          pinned = null; // a trigger always plays per the graph, never pinned
          build(animator.activeState);
        }
        animator.fireTrigger(target.trigger);
      } else {
        inputs.set(target.input, target.value);
        animator.setInput(target.input, target.value);
      }
      animator.update(0); // take the transition now rather than on the next frame
    },
    dispose() {
      unsubscribe();
      animator.dispose();
    },
  };
}
