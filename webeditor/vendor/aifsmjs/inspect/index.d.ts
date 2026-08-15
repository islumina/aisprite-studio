import { h as MiddlewareContext, g as Middleware } from '../types-DIM7QTtf.js';

/**
 * Log every transition that changed the snapshot. Default formatter:
 *   "[EVENT_TYPE] oldState → newState"
 *
 * Pass a custom `out` callback to integrate with structured logging.
 */
declare function logger<Ctx, Evt extends {
    type: string;
}, States extends string>(out?: (line: string, ctx: MiddlewareContext<Ctx, Evt, States>) => void): Middleware<Ctx, Evt, States>;
type StorageLike = {
    setItem(key: string, value: string): void;
};
/**
 * Persist the latest snapshot to a storage-like sink on every change. The
 * snapshot is JSON-serialised; non-serializable context fields will throw.
 *
 * For replay, pair this with `aifsmjs/replay` and an event log of your own
 * choosing — this middleware only persists the latest snapshot.
 */
declare function persist<Ctx, Evt extends {
    type: string;
}, States extends string>(opts: {
    key: string;
    storage: StorageLike;
}): Middleware<Ctx, Evt, States>;
/**
 * Collect every event-snapshot pair into the supplied array. Useful for
 * test assertions, time-travel debugging, or building event logs to feed
 * back into `replay()`.
 */
type RecordedEntry<Ctx, Evt, States extends string> = Readonly<{
    event: MiddlewareContext<Ctx, Evt, States>["event"];
    prev: MiddlewareContext<Ctx, Evt, States>["prev"];
    next: MiddlewareContext<Ctx, Evt, States>["next"];
    changed: boolean;
}>;
declare function recorder<Ctx, Evt extends {
    type: string;
}, States extends string>(sink: RecordedEntry<Ctx, Evt, States>[]): Middleware<Ctx, Evt, States>;

export { Middleware, MiddlewareContext, type RecordedEntry, type StorageLike, logger, persist, recorder };
