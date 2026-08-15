import { S as Snapshot, E as Effect, f as MachineDef, I as Implementations } from '../types-DIM7QTtf.js';

type ReplayResult<Ctx, States extends string> = Readonly<{
    snapshot: Snapshot<Ctx, States>;
    effects: readonly Effect[];
}>;
/**
 * Fold an event log into a final snapshot via `step()`. Effects are collected
 * but never dispatched — this is a pure function, suitable for PBT, time
 * travel, and incident reproduction.
 *
 * Equivalent to:
 *   events.reduce((s, e) => step(def, s, e, impl).snapshot, initial)
 * but also accumulates the effects across all events.
 */
declare function replay<Ctx, Evt extends {
    type: string;
}, States extends string>(initial: Snapshot<Ctx, States>, events: readonly Evt[], def: MachineDef<Ctx, Evt, States>, impl: Implementations<Ctx, Evt>): ReplayResult<Ctx, States>;

export { type ReplayResult, replay };
