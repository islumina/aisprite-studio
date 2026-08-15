// AIPLAYBOOK — atlas runtime selection
//
// Current atlases use the input-driven aispritejs graph. The legacy aifsmjs
// shape is retained as a compatibility path for older hand-authored atlases.
import { createSpriteAnimator } from 'aispritejs';
import { parseAtlas } from 'aispritejs/atlas';
import { startFsm } from './fsm.js';

function isLegacyFsm(atlas) {
  return Boolean(atlas?.states?.definitions);
}

export function isSpriteGraph(atlas) {
  return Boolean(
    atlas?.states
    && !atlas.states.definitions
    && Object.keys(atlas.states).length > 0
    && atlas.inputs
    && Array.isArray(atlas.transitions),
  );
}

function matchingInput(inputs, type, keywords) {
  return Object.entries(inputs).find(([name, def]) => (
    def?.type === type && keywords.some((word) => name.toLowerCase().includes(word))
  ))?.[0];
}

function startSpriteRuntime(atlas, onState, initialState) {
  const parsed = parseAtlas(atlas);
  const graph = initialState && parsed.states[initialState]
    ? { ...parsed, initial: initialState }
    : parsed;
  const animator = createSpriteAnimator(graph);
  const speedInput = matchingInput(graph.inputs, 'number', ['speed', 'velocity', 'move']);
  const attackInput = matchingInput(graph.inputs, 'trigger', ['attack', 'damage', 'hit']);

  const unsubscribe = animator.onStateChange((to) => onState(to));
  onState(animator.activeState);

  function commandTarget(type) {
    if (type === 'STOP') return speedInput ? { input: speedInput, value: 0 } : null;
    if (type === 'MOVE' || type.startsWith('MOVE_')) {
      return speedInput ? { input: speedInput, value: 1 } : null;
    }
    if (type === 'ATTACK' || type === 'DAMAGE') {
      return attackInput ? { trigger: attackInput } : null;
    }
    return null;
  }

  return {
    send(type) {
      const target = commandTarget(type);
      if (!target) return;
      if (target.trigger) animator.fireTrigger(target.trigger);
      else animator.setInput(target.input, target.value);
      animator.update(0);
    },
    can: (type) => commandTarget(type) !== null,
    current: () => animator.activeState,
    complete() {
      const state = graph.states[animator.activeState];
      if (!state || state.loop === true) return;
      const duration = graph.animations[state.animation]
        .reduce((total, key) => total + (graph.frames?.[key]?.duration ?? graph.defaultFrameDuration ?? 100), 0);
      // update() applies state.speed to wall-clock dt. Match the duration that
      // PixiJS just played so slow states also reach their onEnd transition.
      animator.update(Math.ceil(duration / (state.speed ?? 1)) + 1);
    },
    dispose() {
      unsubscribe();
      animator.dispose();
    },
  };
}

export function startRuntime(atlas, onState, initialState) {
  if (isSpriteGraph(atlas)) return startSpriteRuntime(atlas, onState, initialState);
  if (atlas?.assetType !== 'character' || !isLegacyFsm(atlas)) return null;

  const legacy = startFsm(atlas, onState, initialState);
  if (!legacy) return null;
  return {
    ...legacy,
    complete: () => legacy.send('ANIM_END'),
  };
}

export function validateRuntime(atlas) {
  if (!isSpriteGraph(atlas)) return;
  const animator = createSpriteAnimator(parseAtlas(atlas));
  animator.dispose();
}
