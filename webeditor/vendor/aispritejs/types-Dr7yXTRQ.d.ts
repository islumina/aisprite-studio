/**
 * Declaration of a continuous **Number** input (e.g. `speed`). Read/written
 * with {@link SpriteAnimator.setInput}.
 *
 * @public
 */
interface NumberInputDef {
    readonly type: "number";
    /** Value before any `setInput`. Defaults to `0`. */
    readonly default?: number;
}
/**
 * Declaration of a toggle **Boolean** input (e.g. `isGrounded`). Read/written
 * with {@link SpriteAnimator.setInput}.
 *
 * @public
 */
interface BooleanInputDef {
    readonly type: "boolean";
    /** Value before any `setInput`. Defaults to `false`. */
    readonly default?: boolean;
}
/**
 * Declaration of a one-shot **Trigger** input (e.g. `jump`). Fired with
 * {@link SpriteAnimator.fireTrigger}; auto-resets when a transition consumes
 * it. A trigger has no stored value and no `default`.
 *
 * @public
 */
interface TriggerInputDef {
    readonly type: "trigger";
}
/**
 * One of the three input kinds that drive the visual state machine.
 *
 * @public
 */
type InputDef = NumberInputDef | BooleanInputDef | TriggerInputDef;
/**
 * A visual state: which animation plays, whether it loops, how fast, and what
 * to do when a non-looping clip ends.
 *
 * @public
 */
interface StateDef {
    /** Key into {@link SpriteGraph.animations}. Must reference a non-empty list. */
    readonly animation: string;
    /**
     * `true` — the clip wraps forever; `onComplete` never fires for this state.
     * `false` (default) — the clip plays once and holds the last frame, firing
     * `onComplete` exactly once on the update that reaches the end.
     */
    readonly loop?: boolean;
    /**
     * Playback-speed multiplier applied as a time scale on `dt` (so `2` plays
     * twice as fast, `0.5` half speed). Must be `> 0`. Defaults to `1`.
     */
    readonly speed?: number;
    /**
     * Optional state to auto-transition to when a **non-looping** clip ends —
     * the visual equivalent of "attack → return to idle". Fires `onComplete`
     * first, then switches (firing `onStateChange`). Must reference a declared
     * state, and requires `loop` to be `false` (combining it with `loop:true` is
     * rejected at load, since the clip would never end).
     */
    readonly onEnd?: string;
}
/**
 * Comparison operator for a {@link TransitionCondition}.
 *
 * - `Equals` / `NotEquals` — Number or Boolean inputs.
 * - `GreaterThan` / `LessThan` — Number inputs only.
 * - `Trigger` — Trigger inputs only; satisfied while the trigger is pending,
 *   and **consumes** it when the owning transition is taken.
 *
 * @public
 */
type ConditionOp = "Equals" | "NotEquals" | "GreaterThan" | "LessThan" | "Trigger";
/**
 * A single check over one input. A {@link TransitionDef} fires only when all
 * of its conditions hold (logical AND).
 *
 * @public
 */
interface TransitionCondition {
    /** Name of a declared input in {@link SpriteGraph.inputs}. */
    readonly input: string;
    /** The comparison; must be valid for the input's kind. */
    readonly op: ConditionOp;
    /**
     * Right-hand operand for `Equals` / `NotEquals` / `GreaterThan` / `LessThan`.
     * Its type must match the input kind (number for Number, boolean for
     * Boolean). Omitted for `Trigger`.
     */
    readonly value?: number | boolean;
}
/**
 * A directed edge in the transition graph: from one state (or **Any State**)
 * to another when all conditions hold.
 *
 * @public
 */
interface TransitionDef {
    /**
     * Source state name, or `"*"` for an **Any-State** transition that is
     * evaluated from every state.
     */
    readonly from: string;
    /** Target state name. Must reference a declared state. */
    readonly to: string;
    /**
     * Conditions that must all hold (AND). An empty/omitted list matches
     * unconditionally — rarely useful except with a `Trigger` elsewhere.
     */
    readonly when?: readonly TransitionCondition[];
    /**
     * Higher wins. Among satisfied transitions, the highest priority is taken;
     * ties break by declared order (earliest first). An integer (negative
     * allowed); defaults to `0`. A non-integer (`1.5`, `NaN`, `Infinity`, a
     * string) throws {@link InvalidGraphError} at load. (The JSON Schema
     * constrains it to `integer`; TypeScript widens it to `number`.)
     *
     * Exception: a satisfied Number/Boolean self-transition (`to === from`)
     * that consumes no Trigger is skipped regardless of its priority, so it
     * cannot hold the state against other exits — resolution keeps scanning
     * lower-priority candidates instead of stopping there. A self-transition
     * that consumes a Trigger is not exempt and still wins on priority.
     */
    readonly priority?: number;
}
/**
 * Per-frame timing read by the core. The full PixiJS-v8 atlas frame object
 * (with `frame`, `anchor`, `sourceSize`, …) is assignable here — the core
 * only ever reads `duration`.
 *
 * @public
 */
interface FrameTiming {
    /** Display time of this frame in milliseconds. Must be `> 0` if present. */
    readonly duration?: number;
}
/**
 * The complete input-driven control graph plus the frame data the core needs
 * to compute timing. The `animations` / `frames` blocks mirror a PixiJS-v8
 * spritesheet; `inputs` / `states` / `transitions` are `aispritejs`-specific.
 *
 * @public
 */
interface SpriteGraph {
    /** Animation name → ordered list of frame keys. Each list must be non-empty. */
    readonly animations: Readonly<Record<string, readonly string[]>>;
    /**
     * Optional per-frame timing keyed by frame key. Frames absent here (or
     * present without a `duration`) fall back to {@link SpriteGraph.defaultFrameDuration}.
     */
    readonly frames?: Readonly<Record<string, FrameTiming>>;
    /** Input declarations keyed by input name. */
    readonly inputs: Readonly<Record<string, InputDef>>;
    /** State declarations keyed by state name. Must be non-empty. */
    readonly states: Readonly<Record<string, StateDef>>;
    /** Transition edges, evaluated every `update`. */
    readonly transitions: readonly TransitionDef[];
    /**
     * Name of the starting state. Defaults to the first key of `states` in
     * declaration order. Must reference a declared state.
     */
    readonly initial?: string;
    /**
     * Fallback frame duration (ms) for frames without explicit timing.
     * Must be `> 0`. Defaults to `100`.
     */
    readonly defaultFrameDuration?: number;
}
/**
 * Handler for {@link SpriteAnimator.onStateChange}. Called after the machine
 * switches state, with the new and previous state names.
 *
 * @public
 */
type StateChangeHandler = (to: string, from: string) => void;
/**
 * Handler for {@link SpriteAnimator.onComplete}. Called once when a
 * non-looping state's clip reaches its end, with that state's name.
 *
 * @public
 */
type CompleteHandler = (state: string) => void;
/**
 * Options shared by every `on...` subscription.
 *
 * @public
 */
interface ListenerOptions {
    /** Aborting this signal removes the listener. */
    readonly signal?: AbortSignal;
    /** Remove the listener automatically after its first call. */
    readonly once?: boolean;
}
/**
 * Returned by every `on...` subscription; call it to remove the listener.
 * Idempotent.
 *
 * @public
 */
type Unsubscribe = () => void;
/**
 * The renderer-agnostic visual animator returned by `createSpriteAnimator`.
 *
 * Set inputs, call {@link SpriteAnimator.update} once per frame with the
 * elapsed milliseconds, then read {@link SpriteAnimator.activeFrameKey} and
 * hand it to a renderer adapter. The core never touches a canvas, the DOM, or
 * PixiJS.
 *
 * @public
 */
interface SpriteAnimator {
    /**
     * Set a Number or Boolean input. Throws {@link UnknownInputError} if the
     * name is not declared and {@link InputTypeError} on a kind mismatch (or if
     * the name is a Trigger — use {@link SpriteAnimator.fireTrigger}).
     */
    setInput(name: string, value: number | boolean): void;
    /**
     * Mark a Trigger pending. It stays pending until a transition that checks it
     * is taken, which consumes it. Throws {@link UnknownInputError} /
     * {@link InputTypeError} for an unknown or non-Trigger input.
     */
    fireTrigger(name: string): void;
    /**
     * Advance by `deltaMs`: evaluate transitions, recompute the active frame,
     * and fire `onComplete` for a finished non-looping clip. A negative,
     * non-finite, or non-number `deltaMs` is clamped to no progress, and so is a
     * step that would overflow the playback clock to `Infinity`.
     * Deterministic — identical inputs and `dt` sequences yield identical frames.
     *
     * Run-to-completion: an `update()` / `reset()` called from inside an
     * `onStateChange` / `onComplete` listener is queued and runs after the
     * current call finishes (including its `onEnd` auto-transition), in call
     * order; the nested call returns at once. A listener error drops the queued
     * calls and propagates from the outermost call.
     * Throws {@link SpriteAnimatorDisposedError} after `dispose` (also when
     * called from a listener).
     */
    update(deltaMs: number): void;
    /**
     * Return to the initial state and reset every input to its default, without
     * releasing buffers. Fires `onStateChange` only if the state actually
     * changed. Queued like {@link SpriteAnimator.update} when called from a
     * listener. Throws {@link SpriteAnimatorDisposedError} after `dispose`.
     */
    reset(): void;
    /**
     * Release all listeners and drop any queued `update()` / `reset()` calls.
     * Never queued: from a listener it stops the current update at once.
     * Idempotent; subsequent mutators throw.
     */
    dispose(): void;
    /**
     * Subscribe to state changes. Returns an unsubscribe.
     * @remarks After `dispose()` this returns a no-op unsubscribe and registers no listener.
     */
    onStateChange(handler: StateChangeHandler, options?: ListenerOptions): Unsubscribe;
    /**
     * Subscribe to non-looping clip completions. Returns an unsubscribe.
     * @remarks After `dispose()` this returns a no-op unsubscribe and registers no listener.
     */
    onComplete(handler: CompleteHandler, options?: ListenerOptions): Unsubscribe;
    /** Current state name. */
    readonly activeState: string;
    /** Current frame key (into the atlas `frames`), for the renderer adapter. */
    readonly activeFrameKey: string;
    /** Index of the current frame within its animation's frame list. */
    readonly activeFrameIndex: number;
    /** `true` once {@link SpriteAnimator.dispose} has been called. */
    readonly disposed: boolean;
}

export type { BooleanInputDef as B, CompleteHandler as C, FrameTiming as F, InputDef as I, ListenerOptions as L, NumberInputDef as N, StateDef as S, TransitionDef as T, Unsubscribe as U, SpriteAnimator as a, SpriteGraph as b, ConditionOp as c, StateChangeHandler as d, TransitionCondition as e, TriggerInputDef as f };
