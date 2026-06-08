import { M as MachineDef, I as Implementations, l as RuntimeOptions, i as Runtime, S as Snapshot, n as StateDef, o as StepResult, A as Action, e as GuardRef, G as Guard, T as TransitionDef } from './types-CGKk6Rur.js';
export { a as ActionRef, E as Effect, b as EffectHandler, c as Enqueuer, d as GuardArgs, f as Middleware, g as MiddlewareContext, R as RESET_EVENT_TYPE, h as ResetEvent, j as RuntimeErrorEvent, k as RuntimeEventMap, m as RuntimeTransitionEvent, p as SubMachineDef } from './types-CGKk6Rur.js';

declare class InvalidDefinitionError extends Error {
    constructor(message: string);
}
/**
 * Validate a machine definition shape and return it. Same reference is
 * returned; no cloning happens. Validation is intentionally shallow.
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
declare function defineMachine<Ctx, Evt extends {
    type: string;
}, States extends string>(def: MachineDef<Ctx, Evt, States>): MachineDef<Ctx, Evt, States>;
/**
 * Curried builder so `States` can be inferred from `keyof states` without
 * `initial` collapsing it to a single literal. Pass `Ctx` and `Evt` as the
 * type arguments; pass the def to the returned `defineMachine`.
 *
 *   const machine = setup<MyCtx, MyEvt>().defineMachine({
 *     id: "m",
 *     initial: "a",
 *     context: { ... },
 *     states: { a: {...}, b: {...} },  // States inferred as "a" | "b"
 *   });
 */
declare function setup<Ctx, Evt extends {
    type: string;
}>(): {
    defineMachine: <const States extends string>(def: {
        readonly id: string;
        readonly initial: NoInfer<States>;
        readonly context: Ctx;
        readonly states: Readonly<Record<States, StateDef<Ctx, Evt, States>>>;
    }) => MachineDef<Ctx, Evt, States>;
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
 * Invariants:
 * - `phase: "init"` — child constructor threw. Parent snapshot was rolled
 *   back to `prev`; no middleware ran; no `'transition'` emitted; no effects.
 * - `phase: "dispose"` — previous child's `dispose()` threw during transition.
 *   Parent snapshot was rolled back to `prev`; child reference is cleared.
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
 * runs the read-only middleware pipeline, dispatches effects, and notifies
 * subscribers. The runtime owns an `AbortController`; `dispose()` aborts it
 * and clears all state.
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
 * Merge a partial context update into the current context. Plain-object
 * contexts get a shallow merge; non-object contexts get replaced wholesale.
 *
 * The function never mutates either argument.
 */
declare function mergeContext<Ctx>(current: Ctx, patch: Partial<Ctx> | void): Ctx;

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
 * Return all transition candidates for (state, eventType). Order is preserved
 * from the declaration so that guard fallthrough behaves predictably.
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

export { Action, AsyncGuardError, Guard, GuardRef, Implementations, InvalidDefinitionError, MachineDef, Runtime, RuntimeDisposedError, RuntimeOptions, Snapshot, StateDef, StepResult, SubMachineError, TransitionDef, UnknownActionError, UnknownGuardError, assign, createMachine, createRuntime, createSnapshot, deepFreeze, defineMachine, evalGuard, freezeSnapshot, initialSnapshot, isAsyncGuardFn, mergeContext, resolveGuard, resolveTransitions, setup, step };
