type Effect = Readonly<{
    type: string;
    payload?: unknown;
}>;
type Enqueuer = Readonly<{
    effect: (type: string, payload?: unknown) => void;
}>;
type GuardArgs<Ctx, Evt> = Readonly<{
    context: Ctx;
    event: Evt;
    /**
     * Optional guard registry, threaded by `evalGuard` so combinators can resolve
     * string refs nested inside `and / or / not`. Inline user guards may safely
     * ignore this field — it is `undefined` when guards are evaluated outside of
     * `evalGuard` (e.g. in unit tests calling the function directly).
     */
    guards?: Readonly<Record<string, Guard<Ctx, Evt>>>;
    /**
     * Current state value, threaded by `evalGuard` from the live snapshot. Used
     * by the `stateIn` combinator. `undefined` when guards are called outside of
     * a lifecycle evaluation.
     */
    value?: string;
}>;
type Guard<Ctx, Evt> = (args: GuardArgs<Ctx, Evt>) => boolean;
type Action<Ctx, Evt> = (args: {
    context: Ctx;
    event: Evt;
    enqueue: Enqueuer;
}) => Partial<Ctx> | void;
type EffectHandler<Ctx, Evt> = (effect: Effect, args: {
    context: Ctx;
    event: Evt;
    signal: AbortSignal;
}) => void | Promise<void>;
type GuardRef<Ctx, Evt> = string | Guard<Ctx, Evt>;
type ActionRef<Ctx, Evt> = string | Action<Ctx, Evt>;
type TransitionDef<Ctx, Evt, States extends string> = Readonly<{
    target?: States;
    guard?: GuardRef<Ctx, Evt>;
    actions?: readonly ActionRef<Ctx, Evt>[];
}>;
/**
 * @experimental v0.3.0
 *
 * A nested machine definition attachable to StateDef.sub. The type parameters
 * are independent from the parent machine's <Ctx, Evt, States>; sub-machines
 * may have entirely unrelated context and event shapes.
 *
 * This is an alias for MachineDef — sub-machines have the same definition
 * shape as top-level machines. The relationship is purely lifecycle:
 * a sub-machine instance is created when its parent state becomes active
 * and disposed when the parent state exits.
 */
type SubMachineDef<SubCtx, SubEvt extends {
    type: string;
}, SubStates extends string> = MachineDef<SubCtx, SubEvt, SubStates>;
type StateDef<Ctx, Evt, States extends string> = Readonly<{
    on?: Readonly<Record<string, TransitionDef<Ctx, Evt, States> | readonly TransitionDef<Ctx, Evt, States>[]>>;
    entry?: readonly ActionRef<Ctx, Evt>[];
    exit?: readonly ActionRef<Ctx, Evt>[];
    final?: boolean;
    /**
     * Optional sub-machine. When the runtime enters a state with `sub`,
     * the sub-machine is lazily instantiated; when it exits, the sub-machine
     * is disposed. See STABILITY.md for the experimental contract.
     *
     * The generic parameters are erased to `any` because sub-machine type
     * parameters are intentionally independent from the parent's `Ctx` / `Evt`
     * / `States`. `MachineDef`'s generics are invariant (guards / actions
     * consume them), so the storage position must use `any` rather than
     * `unknown`. Caller narrows via `runtime.subRuntime() as Runtime<...>`.
     *
     * @experimental since 0.3.0
     */
    sub?: MachineDef<any, any, any>;
    /**
     * Implementations for `sub`. Ignored if `sub` is absent. Defaults to `{}`
     * (sub-machine must rely on inline guards / actions / effects only).
     *
     * @experimental since 0.3.0
     */
    subImpl?: Implementations<any, any>;
}>;
type MachineDef<Ctx, Evt extends {
    type: string;
}, States extends string> = Readonly<{
    id: string;
    initial: States;
    context: Ctx;
    states: Readonly<Record<States, StateDef<Ctx, Evt, States>>>;
}>;
type Snapshot<Ctx, States extends string> = Readonly<{
    value: States;
    context: Ctx;
    status: "active" | "final";
}>;
type Implementations<Ctx, Evt> = Readonly<{
    guards?: Readonly<Record<string, Guard<Ctx, Evt>>>;
    actions?: Readonly<Record<string, Action<Ctx, Evt>>>;
    effects?: Readonly<Record<string, EffectHandler<Ctx, Evt>>>;
}>;
type StepResult<Ctx, States extends string> = Readonly<{
    snapshot: Snapshot<Ctx, States>;
    effects: readonly Effect[];
    changed: boolean;
}>;
/**
 * Sentinel event type that `Runtime.reset()` synthesises when the caller does
 * not pass an explicit event. Middleware receives it through
 * `MiddlewareContext.event`. Exposed so user code can discriminate.
 */
declare const RESET_EVENT_TYPE: "@@aifsmjs/RESET";
type ResetEvent = Readonly<{
    type: typeof RESET_EVENT_TYPE;
}>;
type MiddlewareContext<Ctx, Evt, States extends string> = Readonly<{
    prev: Snapshot<Ctx, States>;
    next: Snapshot<Ctx, States>;
    /**
     * The triggering event. May be the user's `Evt` (from `send()` or an
     * explicit `reset(event)`) or the `ResetEvent` sentinel emitted by a
     * `reset()` with no event argument.
     */
    event: Evt | ResetEvent;
    effects: readonly Effect[];
    changed: boolean;
}>;
type Middleware<Ctx, Evt, States extends string> = (ctx: MiddlewareContext<Ctx, Evt, States>, next: () => void) => void;
/**
 * Payload of the `'transition'` runtime event — emitted after each `send()` or
 * `reset()` that actually changed the snapshot value.
 */
type RuntimeTransitionEvent<Ctx, Evt, States extends string> = Readonly<{
    prev: Snapshot<Ctx, States>;
    next: Snapshot<Ctx, States>;
    event: Evt | ResetEvent;
    effects: readonly Effect[];
    changed: boolean;
}>;
/**
 * Payload of the `'error'` runtime event — currently emitted for async effect
 * handler rejections (which would otherwise become unhandled). Synchronous
 * throws from effect handlers and middleware still propagate to the caller of
 * `send()` / `reset()`.
 */
type RuntimeErrorEvent<Evt> = Readonly<{
    error: unknown;
    event: Evt | ResetEvent | undefined;
}>;
type RuntimeEventMap<Ctx, Evt, States extends string> = {
    transition: RuntimeTransitionEvent<Ctx, Evt, States>;
    error: RuntimeErrorEvent<Evt>;
    dispose: void;
};
interface Runtime<Ctx, Evt extends {
    type: string;
}, States extends string> {
    getSnapshot(): Snapshot<Ctx, States>;
    /** Alias for `getSnapshot()`. */
    snapshot(): Snapshot<Ctx, States>;
    send(event: Evt): Snapshot<Ctx, States>;
    /**
     * Predict whether sending `event` would fire a transition. Reuses
     * `resolveTransitions` + `evalGuard` without applying any actions. Guards
     * are expected to be pure; `can` then matches `send` for the same input.
     */
    can(event: Evt): boolean;
    subscribe(listener: (snap: Snapshot<Ctx, States>) => void): () => void;
    /**
     * EventTarget-like typed listener API. Returns an unsubscribe function.
     * `options.signal` removes the listener when aborted; `options.once`
     * removes the listener after the first invocation. After `dispose()`,
     * `on()` is a no-op and returns a no-op unsubscribe.
     */
    on<K extends keyof RuntimeEventMap<Ctx, Evt, States>>(type: K, listener: (payload: RuntimeEventMap<Ctx, Evt, States>[K]) => void, options?: {
        signal?: AbortSignal;
        once?: boolean;
    }): () => void;
    /**
     * Re-initialise the runtime to the definition's initial snapshot. Triggers
     * subscribers but does NOT run entry actions (reset = re-birth, not
     * "transition into initial"). Throws RuntimeDisposedError if disposed.
     * If an `event` is supplied, middleware sees it as the trigger; otherwise
     * a sentinel `{ type: "@@aifsmjs/RESET" }` is synthesised.
     */
    reset(event?: Evt): Snapshot<Ctx, States>;
    /**
     * Tear down: abort the internal AbortController (effect handlers see signal
     * fire), clear listeners, and mark this runtime as disposed. Subsequent
     * send()/reset() calls throw RuntimeDisposedError. Idempotent.
     */
    dispose(): void;
    /**
     * True after `dispose()` has been called.
     */
    readonly disposed: boolean;
    /**
     * AbortSignal scoped to this runtime's lifetime. Fires once on dispose().
     * Threaded to every EffectHandler invocation; external integrations
     * (e.g. component teardown) can also attach `signal.addEventListener("abort", ...)`.
     */
    readonly signal: AbortSignal;
    /**
     * @experimental v0.3.0
     *
     * Returns the currently active sub-Runtime for the current parent state,
     * or undefined if:
     *   - the current state has no `sub` definition, OR
     *   - the sub-Runtime failed to initialise (SubMachineError was thrown
     *     from `send()` / `reset()` / `createRuntime` per the spec contract),
     *     OR
     *   - the parent runtime has been disposed.
     *
     * The returned Runtime is typed at the loosest sub-machine signature.
     * Caller casts to the concrete sub type.
     *
     * Re-entry: when the parent leaves and re-enters a state with `sub`, a
     * fresh sub-Runtime is constructed. Previous sub-Runtime references held
     * by the caller are stale and MUST NOT be used (disposed).
     */
    subRuntime(): Runtime<unknown, {
        type: string;
    }, string> | undefined;
    /**
     * Semantic sugar for `runtime.on('transition', handler, opts)`. Returns
     * the same unsubscribe function. Sharing the same listener Set with
     * `on('transition', ...)` means registration order determines invocation
     * order across both APIs.
     *
     * @since 0.3.0
     */
    onTransition(handler: (payload: RuntimeTransitionEvent<Ctx, Evt, States>) => void, options?: {
        signal?: AbortSignal;
        once?: boolean;
    }): () => void;
}
type RuntimeOptions<Ctx, Evt, States extends string> = Readonly<{
    middleware?: readonly Middleware<Ctx, Evt, States>[];
    /**
     * If false, do not dispatch effects through the effect handler map.
     * Useful for replay / dry-run modes. Defaults to true.
     */
    dispatchEffects?: boolean;
}>;

export { type Action as A, type Effect as E, type Guard as G, type Implementations as I, type MachineDef as M, RESET_EVENT_TYPE as R, type Snapshot as S, type TransitionDef as T, type ActionRef as a, type EffectHandler as b, type Enqueuer as c, type GuardArgs as d, type GuardRef as e, type Middleware as f, type MiddlewareContext as g, type ResetEvent as h, type Runtime as i, type RuntimeErrorEvent as j, type RuntimeEventMap as k, type RuntimeOptions as l, type RuntimeTransitionEvent as m, type StateDef as n, type StepResult as o, type SubMachineDef as p };
