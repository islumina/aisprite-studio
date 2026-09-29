import { c as Enqueuer, E as Effect, b as EffectHandler } from '../types-CrDxFfBx.js';

/**
 * Build a closure-based Enqueuer that pushes effects into the supplied sink.
 * Each `step()` invocation creates one such enqueuer and discards it
 * afterwards; the sink is the effects array later returned to the caller.
 *
 * Lives in `effects/` because the Enqueuer concept is the effects-domain API
 * — `step()` imports it from here.
 */
declare function createEnqueuer(sink: {
    type: string;
    payload?: unknown;
}[]): Enqueuer;

/**
 * Dispatch a batch of effects through the supplied handler map. Effects whose
 * `type` has no handler are silently skipped (the runtime treats unhandled
 * effects as informational).
 *
 * Returns the array of Promise results (if any handler is async) so callers
 * can `await Promise.all(...)` when they need flushing — the default runtime
 * is fire-and-forget and discards them.
 *
 * Each handler receives an `AbortSignal`. When called from `createRuntime`,
 * the signal is the runtime's own controller. Stand-alone callers may omit
 * `args.signal` (a never-aborting placeholder is supplied) or pass their own
 * (e.g. `AbortSignal.timeout(5000)`, `AbortSignal.any([...])`).
 */
declare function runEffects<Ctx, Evt>(effects: readonly Effect[], handlers: Readonly<Record<string, EffectHandler<Ctx, Evt>>> | undefined, args: {
    context: Ctx;
    event: Evt;
    signal?: AbortSignal;
}): readonly Promise<void>[];

export { Effect, EffectHandler, Enqueuer, createEnqueuer, runEffects };
