import { f as MachineDef, I as Implementations, m as RuntimeOptions, j as Runtime, M as MachineConfig, S as Snapshot, o as StateDef, p as StepResult, A as Action, e as GuardRef, G as Guard, T as TransitionConfig, r as TransitionDef } from './types-CrDxFfBx.js';
export { a as ActionRef, E as Effect, b as EffectHandler, c as Enqueuer, d as GuardArgs, g as Middleware, h as MiddlewareContext, R as RESET_EVENT_TYPE, i as ResetEvent, k as RuntimeErrorEvent, l as RuntimeEventMap, n as RuntimeTransitionEvent, q as SubMachineDef } from './types-CrDxFfBx.js';

/**
 * Thrown for an invalid machine definition and, since 0.6.0, for argument
 * misuse at the definition/runtime boundary (`defineMachine`,
 * `setup().defineMachine`, `createMachine`, `createRuntime`, and the
 * `send` / `reset` / `subscribe` / `on` / `onTransition` runtime methods).
 * Messages read `aifsmjs: <subject> must be <constraint>`.
 */
declare class InvalidDefinitionError extends Error {
    constructor(message: string);
}
/**
 * Validate a machine definition shape and return it. When `context` is
 * provided the same reference is returned; when it is omitted a shallow copy
 * with `context: {}` is returned. Validation is intentionally shallow.
 *
 * Two call forms:
 *
 *   defineMachine<Ctx, Evt, States>({ ... })
 *     Explicit generics. Use when you need full control (e.g. union event
 *     types). Required because TypeScript cannot otherwise infer `Evt`.
 *
 *   setup<Ctx, Evt>().defineMachine({ ... })
 *     Curried form. Lets `States` be inferred from `keyof states`, so you
 *     can omit it. Recommended for typical usage.
 */
declare function defineMachine<Ctx = Record<string, never>, Evt extends {
    type: string;
} = {
    type: string;
}, States extends string = string>(def: MachineConfig<Ctx, Evt, States>): MachineDef<Ctx, Evt, States>;
/**
 * Curried builder so `States` can be inferred from `keyof states` without
 * `initial` or a transition `target` collapsing it to a single literal. Pass
 * `Ctx` and `Evt` as the type arguments; pass the def to the returned
 * `defineMachine`.
 *
 *   const machine = setup<MyCtx, MyEvt>().defineMachine({
 *     id: "m",
 *     initial: "a",
 *     context: { ... },
 *     states: { a: {...}, b: {...} },  // States inferred as "a" | "b"
 *   });
 */
declare function setup<Ctx = Record<string, never>, Evt extends {
    type: string;
} = {
    type: string;
}>(): {
    defineMachine: <const States extends string>(def: Readonly<{
        id: string;
        initial: NoInfer<States>;
        states: Readonly<{
            [K in States]: StateDef<Ctx, Evt, NoInfer<States>>;
        }>;
    }> & (Record<string, never> extends Ctx ? {
        readonly context?: Ctx;
    } : {
        readonly context: Ctx;
    })) => MachineDef<Ctx, Evt, States>;
};
/**
 * Build the initial snapshot for a machine.
 */
declare function initialSnapshot<Ctx, Evt extends {
    type: string;
}, States extends string>(def: MachineDef<Ctx, Evt, States>): Snapshot<Ctx, States>;
/**
 * Convenience factory that composes `defineMachine` and `createRuntime` in
 * one call for the common case where you do not need to keep the machine
 * definition around for serialization or sharing.
 *
 * For type inference over `States` from `keyof states`, prefer
 * `setup<Ctx, Evt>().defineMachine(...)` then pass the result to
 * `createRuntime` separately. `createMachine` is the spec-style entry point
 * documented in the ai*js ecosystem review.
 */
declare function createMachine<Ctx, Evt extends {
    type: string;
}, States extends string>(def: MachineDef<Ctx, Evt, States>, impl: Implementations<Ctx, Evt>, opts?: RuntimeOptions<Ctx, Evt, States>): Runtime<Ctx, Evt, States>;

declare class UnknownActionError extends Error {
    readonly actionName: string;
    constructor(actionName: string);
}
/**
 * Thrown (from `step()`, and so from `send()` before anything is committed)
 * when an action returns a non-nullish primitive (`false`, `0`, `""`, ...) as
 * the patch for an object context. An object context accepts only a
 * plain-object patch or `undefined`/`null` (no change).
 *
 * `actionName` is the string ref, the inline function's name, or `"<inline>"`
 * for an anonymous inline action (mirrors guard naming).
 *
 * @since 0.6.0
 */
declare class InvalidActionResultError extends Error {
    readonly actionName: string;
    constructor(actionName: string, patch: unknown);
}
/**
 * Compute the next snapshot and collected effects from a single event.
 *
 * Order is fixed and uninterruptible:
 *   1. resolve candidate transitions for (state, event.type)
 *   2. evaluate guards in declaration order; pick the first passing one
 *   3. if external (target defined), run exit actions of the old state
 *   4. run transition.actions in declaration order
 *   5. if external, run entry actions of the new state
 *   6. return { snapshot, effects, changed }
 *
 * The function is pure: it never dispatches effects and never mutates inputs.
 * Each guard on the path is evaluated at most once.
 */
declare function step<Ctx, Evt extends {
    type: string;
}, States extends string>(def: MachineDef<Ctx, Evt, States>, snapshot: Snapshot<Ctx, States>, event: Evt, impl: Implementations<Ctx, Evt>): StepResult<Ctx, States>;

declare class RuntimeDisposedError extends Error {
    constructor();
}
/**
 * Thrown by `send()` / `reset()` when a sub-machine init or dispose throws.
 *
 * Prepare-then-commit: the new child is constructed before the previous one
 * is disposed. Invariants:
 * - `phase: "init"` — the new child's constructor threw. The parent snapshot
 *   is not committed and the previous child (if any) is untouched: still live
 *   and still returned by `subRuntime()`. No middleware ran, no `'transition'`
 *   was emitted, no effects were dispatched.
 * - `phase: "dispose"` — the previous child's `dispose()` threw. The new
 *   child (if any) was discarded, the parent snapshot is not committed, and
 *   `subRuntime()` returns `undefined` until the sub state is re-entered.
 * - Never thrown from `runtime.dispose()` cascade (never-throws contract).
 *
 * @since 0.3.0
 */
declare class SubMachineError extends Error {
    readonly parentState: string;
    readonly phase: "init" | "dispose";
    readonly cause: unknown;
    constructor(parentState: string, phase: "init" | "dispose", cause: unknown);
}
/**
 * Build a thin stateful runtime around a machine. `send()` calls `step()`,
 * commits, runs the read-only middleware pipeline, dispatches effects, and
 * notifies subscribers then `'transition'` listeners. `send()`/`reset()` are
 * run-to-completion: a call made while the runtime is already dispatching
 * (from middleware, an effect handler, a listener, or a child runtime) is
 * queued FIFO and processed after the current event's last notification.
 * The runtime owns an `AbortController`; `dispose()` aborts it and clears all
 * state.
 *
 * Arguments are validated before anything is created: a non-object `def`,
 * `def.states`, `impl` or `opts`, or a `middleware` option that is not an
 * array of functions, throws `InvalidDefinitionError`. The rest of `def` is
 * trusted (build it with `defineMachine` / `setup().defineMachine`).
 */
declare function createRuntime<Ctx, Evt extends {
    type: string;
}, States extends string>(def: MachineDef<Ctx, Evt, States>, impl: Implementations<Ctx, Evt>, opts?: RuntimeOptions<Ctx, Evt, States>): Runtime<Ctx, Evt, States>;

/**
 * Build an Action that returns a Partial<Ctx> from a pure updater.
 * The partial is merged into the current context by `step()`.
 */
declare function assign<Ctx, Evt>(updater: (args: {
    context: Ctx;
    event: Evt;
}) => Partial<Ctx>): Action<Ctx, Evt>;
/**
 * Merge an action's result into the current context. The function never
 * mutates either argument.
 *
 * - `undefined` / `null` patch: `current` is returned unchanged.
 * - Object context (not an array or `ArrayBuffer` view) + plain-object patch:
 *   shallow merge into a new object that keeps `current`'s prototype, so a
 *   class-instance context keeps its methods and untouched fields. Only own
 *   enumerable (string and symbol) properties are carried; `#private` and
 *   non-enumerable members are not, so prefer plain-object contexts.
 * - Object context + non-nullish primitive patch (`false`, `0`, `""`, ...):
 *   throws {@link InvalidActionResultError} (`actionName` names the action).
 * - Anything else (a primitive or array context, or a non-plain-object patch
 *   such as an array or class instance): the patch replaces `current`.
 */
declare function mergeContext<Ctx>(current: Ctx, patch: Partial<Ctx> | void, actionName?: string): Ctx;

declare class UnknownGuardError extends Error {
    readonly guardName: string;
    constructor(guardName: string);
}
declare class AsyncGuardError extends Error {
    readonly guardName: string;
    constructor(guardName: string);
}
/**
 * Detect declared-async guards at definition time. Catches the common case of
 * `async (args) => ...` inline guards. Combinator builders or arrow returns of
 * a Promise still slip past — those are caught at `evalGuard` runtime via
 * the `isThenable` check.
 *
 * Caveat: this relies on `Function.prototype.constructor.name === "AsyncFunction"`,
 * which is reliable in ES2017+ runtimes. If your bundler transpiles `async`
 * to generator-based code (e.g. ES5 / very old TypeScript targets), this
 * check returns `false` for those forms — the runtime `evalGuard` thenable
 * check still catches them.
 */
declare function isAsyncGuardFn(fn: unknown): boolean;
/**
 * Resolve a guard ref to a Guard function. String refs are looked up in the
 * implementations map; inline functions are returned as-is.
 */
declare function resolveGuard<Ctx, Evt>(ref: GuardRef<Ctx, Evt>, impl: Implementations<Ctx, Evt>): Guard<Ctx, Evt>;
/**
 * Evaluate a guard ref against (context, event). Guards must be sync and pure;
 * TypeScript blocks declared-async signatures at compile time, but JS callers
 * or casts can still slip through. This function checks two ways:
 *   1. Inline AsyncFunction (declared `async`) → throw AsyncGuardError.
 *   2. Return value is a Promise → throw AsyncGuardError.
 * Both throws are user errors; they would otherwise silently pass the guard
 * (Promise is truthy) and break determinism.
 *
 * The optional `value` argument is the current state value, threaded so the
 * `stateIn` combinator and similar predicates can introspect it.
 */
declare function evalGuard<Ctx, Evt>(ref: GuardRef<Ctx, Evt>, context: Ctx, event: Evt, impl: Implementations<Ctx, Evt>, value?: string): boolean;

/**
 * Normalize a single transition config into its object form. The string
 * shorthand `"targetState"` (à la XState) becomes `{ target: "targetState" }`;
 * the object form is returned unchanged. Centralised here so every consumer
 * (`step`, `resolveTransitions`, `can`, validation) sees the same shape.
 *
 * @since 0.5.3
 */
declare function normalizeTransition<Ctx, Evt, States extends string>(entry: TransitionConfig<Ctx, Evt, States>): TransitionDef<Ctx, Evt, States>;
/**
 * Normalize the raw `state.on[eventType]` value (object, string shorthand, or
 * an array mixing both) into an ordered list of {@link TransitionDef} objects.
 * Declaration order is preserved.
 *
 * @since 0.5.3
 */
declare function normalizeTransitions<Ctx, Evt, States extends string>(entry: TransitionConfig<Ctx, Evt, States> | readonly TransitionConfig<Ctx, Evt, States>[] | undefined): readonly TransitionDef<Ctx, Evt, States>[];
/**
 * Return all transition candidates for (state, eventType). Order is preserved
 * from the declaration so that guard fallthrough behaves predictably. String
 * shorthands are normalized to `{ target }` objects.
 *
 * If the event has no entry under the given state, an empty array is returned.
 */
declare function resolveTransitions<Ctx, Evt extends {
    type: string;
}, States extends string>(def: MachineDef<Ctx, Evt, States>, stateValue: States, eventType: string): readonly TransitionDef<Ctx, Evt, States>[];

declare function deepFreeze<T>(value: T): T;
/**
 * Wrap a freshly built snapshot. In dev mode the whole tree is deep-frozen so
 * accidental mutation throws immediately. In production only the top object is
 * frozen, keeping the cost negligible.
 */
declare function freezeSnapshot<C, S extends string>(snap: Snapshot<C, S>): Snapshot<C, S>;
declare function createSnapshot<C, S extends string>(args: {
    value: S;
    context: C;
    status?: "active" | "final";
}): Snapshot<C, S>;

export { Action, AsyncGuardError, Guard, GuardRef, Implementations, InvalidActionResultError, InvalidDefinitionError, MachineConfig, MachineDef, Runtime, RuntimeDisposedError, RuntimeOptions, Snapshot, StateDef, StepResult, SubMachineError, TransitionConfig, TransitionDef, UnknownActionError, UnknownGuardError, assign, createMachine, createRuntime, createSnapshot, deepFreeze, defineMachine, evalGuard, freezeSnapshot, initialSnapshot, isAsyncGuardFn, mergeContext, normalizeTransition, normalizeTransitions, resolveGuard, resolveTransitions, setup, step };
