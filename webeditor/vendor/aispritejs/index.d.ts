import { b as SpriteGraph, a as SpriteAnimator } from './types-BS72pefJ.js';
export { B as BooleanInputDef, C as CompleteHandler, c as ConditionOp, F as FrameTiming, I as InputDef, L as ListenerOptions, N as NumberInputDef, d as StateChangeHandler, S as StateDef, e as TransitionCondition, T as TransitionDef, f as TriggerInputDef, U as Unsubscribe } from './types-BS72pefJ.js';

/**
 * Build a renderer-agnostic visual animator from an input-driven graph.
 *
 * @param graph - inputs, states, transitions, animations (+ optional per-frame
 *   timings). Validated eagerly; an invalid graph throws {@link InvalidGraphError}
 *   and no animator is returned.
 * @returns a {@link SpriteAnimator}.
 *
 * @public
 */
declare function createSpriteAnimator(graph: SpriteGraph): SpriteAnimator;

/**
 * Thrown by `setInput` / `fireTrigger` / `update` / `reset` after the animator
 * has been disposed.
 *
 * @public
 */
declare class SpriteAnimatorDisposedError extends Error {
    constructor();
}
/**
 * Thrown by `createSpriteAnimator` when the graph fails validation — a state
 * references a missing animation, a transition points at an unknown state, a
 * condition uses an operator the input kind does not support, a duration is
 * non-positive, and so on. Fail-fast: an invalid graph never produces a
 * half-built animator.
 *
 * @public
 */
declare class InvalidGraphError extends Error {
    constructor(message: string);
}
/**
 * Thrown by `setInput` / `fireTrigger` when the named input is not declared in
 * the graph's `inputs` block.
 *
 * @public
 */
declare class UnknownInputError extends Error {
    readonly input: string;
    constructor(input: string);
}
/**
 * Thrown when an input is used against its kind — `setInput` with the wrong
 * value type, `setInput` on a Trigger, or `fireTrigger` on a non-Trigger.
 *
 * @public
 */
declare class InputTypeError extends Error {
    readonly input: string;
    constructor(input: string, message: string);
}

export { InputTypeError, InvalidGraphError, SpriteAnimator, SpriteAnimatorDisposedError, SpriteGraph, UnknownInputError, createSpriteAnimator };
