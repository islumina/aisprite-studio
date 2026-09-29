import * as fc from 'fast-check';
import { j as Runtime, f as MachineDef, I as Implementations } from '../types-CrDxFfBx.js';

/**
 * Pure-model representation of an FSM run, used by `fc.commands`.
 * `reached` tracks every state visited so generic properties can check
 * containment without re-running.
 */
type FsmModel<Ctx, States extends string> = {
    value: States;
    context: Ctx;
    status: "active" | "final";
    reached: Set<States>;
};
type EventArbitraries<Evt extends {
    type: string;
}> = Readonly<Record<string, fc.Arbitrary<Evt>>>;
type FsmCommand<Ctx, Evt extends {
    type: string;
}, States extends string> = fc.Command<FsmModel<Ctx, States>, Runtime<Ctx, Evt, States>>;
declare function initialModel<Ctx, Evt extends {
    type: string;
}, States extends string>(def: MachineDef<Ctx, Evt, States>): FsmModel<Ctx, States>;
/**
 * Build an `fc.Arbitrary` of FSM command sequences. Each command pulls one
 * event from the user-supplied arbitrary map and, when run, asserts that the
 * pure `step()` prediction matches the runtime's observable outcome.
 *
 * Pair this arbitrary with `fc.property(...)` inside a `fc.assert(...)` call,
 * or use the helpers in `aifsmjs/pbt` properties to get the six generic
 * invariants for free.
 */
declare function commandsFromMachine<Ctx, Evt extends {
    type: string;
}, States extends string>(def: MachineDef<Ctx, Evt, States>, impl: Implementations<Ctx, Evt>, eventArbitraries: EventArbitraries<Evt>): fc.Arbitrary<Iterable<FsmCommand<Ctx, Evt, States>>>;

type AssertOpts = Readonly<{
    numRuns?: number;
    seed?: number;
    verbose?: boolean;
}>;
/**
 * Structural deep-equality for two context values (C3). Backed by `node:util`
 * `isDeepStrictEqual`, replacing the previous `JSON.stringify(a) === JSON.stringify(b)`
 * oracle which was unsound:
 *
 *   - key-order-sensitive  → false-FAIL on `{a:1,b:2}` vs `{b:2,a:1}`;
 *   - drops undefined keys  → false-PASS on `{v:undefined,w:1}` vs `{w:1}`;
 *   - lossy for `Map`/`Set`/`Date` (all serialise to `{}` or an ISO string);
 *   - throws on `BigInt`.
 *
 * `isDeepStrictEqual` distinguishes present-but-undefined from absent keys,
 * compares `Map`/`Set`/`Date` by contents, and tolerates `BigInt` — exactly
 * the verdicts a context-equality oracle for PBT requires. No new dependency
 * (Node built-in; the package already targets Node >=18).
 */
declare function contextEquals(a: unknown, b: unknown): boolean;
/**
 * #1 snapshotAlwaysFrozen — after any event sequence the live snapshot remains
 * frozen at the top level.
 */
declare function snapshotAlwaysFrozen<Ctx, Evt extends {
    type: string;
}, States extends string>(def: MachineDef<Ctx, Evt, States>, impl: Implementations<Ctx, Evt>, eventArbitraries: EventArbitraries<Evt>, opts?: AssertOpts): void;
/**
 * #2 unknownEventNoOp — sending an event whose `type` is not declared in any
 * state's `on` map never changes the snapshot.
 */
declare function unknownEventNoOp<Ctx, Evt extends {
    type: string;
}, States extends string>(def: MachineDef<Ctx, Evt, States>, impl: Implementations<Ctx, Evt>, unknownType: string, opts?: AssertOpts): void;
/**
 * #3 reachableStatesSubsetDeclared — every state visited during a run belongs
 * to `def.states`.
 */
declare function reachableStatesSubsetDeclared<Ctx, Evt extends {
    type: string;
}, States extends string>(def: MachineDef<Ctx, Evt, States>, impl: Implementations<Ctx, Evt>, eventArbitraries: EventArbitraries<Evt>, opts?: AssertOpts): void;
/**
 * #4 replayEqualsFold — `replay(initial, log)` produces the same final state
 * as a live runtime fed the same events. Effects dispatched by the runtime are
 * ignored; the comparison is on `{ value, context }`.
 */
declare function replayEqualsFold<Ctx, Evt extends {
    type: string;
}, States extends string>(def: MachineDef<Ctx, Evt, States>, impl: Implementations<Ctx, Evt>, eventArbitraries: EventArbitraries<Evt>, opts?: AssertOpts): void;
/**
 * #5 guardsFalseNoTransition — when every candidate transition for the current
 * (state, event) pair carries a guard and every guard returns `false`, the
 * snapshot is unchanged (`changed === false`).
 *
 * Implementation: synthesise an impl that forces every guard to `false`, then
 * for each step whose candidate list is fully guarded, assert the step did not
 * change state. Steps with an unguarded fallback candidate (which fires even
 * when all guards are false) are skipped — the README claim is specifically
 * about the all-guards-false case.
 */
declare function guardsFalseNoTransition<Ctx, Evt extends {
    type: string;
}, States extends string>(def: MachineDef<Ctx, Evt, States>, impl: Implementations<Ctx, Evt>, eventArbitraries: EventArbitraries<Evt>, opts?: AssertOpts): void;
/**
 * #6 assignDoesNotMutate — running an `assign`-style action never mutates the
 * previous context object. Verified by re-checking the own state of every
 * object reachable from the pre-step context.
 */
declare function assignDoesNotMutate<Ctx, Evt extends {
    type: string;
}, States extends string>(def: MachineDef<Ctx, Evt, States>, impl: Implementations<Ctx, Evt>, eventArbitraries: EventArbitraries<Evt>, opts?: AssertOpts): void;
/**
 * Assert every generic property in one call. Use this when you don't need
 * fine-grained control over per-property options.
 */
declare function assertAll<Ctx, Evt extends {
    type: string;
}, States extends string>(def: MachineDef<Ctx, Evt, States>, impl: Implementations<Ctx, Evt>, eventArbitraries: EventArbitraries<Evt>, opts?: AssertOpts & {
    unknownEventType?: string;
}): void;

declare const properties: Readonly<{
    assertAll: typeof assertAll;
    assignDoesNotMutate: typeof assignDoesNotMutate;
    contextEquals: typeof contextEquals;
    guardsFalseNoTransition: typeof guardsFalseNoTransition;
    reachableStatesSubsetDeclared: typeof reachableStatesSubsetDeclared;
    replayEqualsFold: typeof replayEqualsFold;
    snapshotAlwaysFrozen: typeof snapshotAlwaysFrozen;
    unknownEventNoOp: typeof unknownEventNoOp;
}>;

export { type AssertOpts, type EventArbitraries, type FsmCommand, type FsmModel, assertAll, assignDoesNotMutate, commandsFromMachine, guardsFalseNoTransition, initialModel, properties, reachableStatesSubsetDeclared, replayEqualsFold, snapshotAlwaysFrozen, unknownEventNoOp };
