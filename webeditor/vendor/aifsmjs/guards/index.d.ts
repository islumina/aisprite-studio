import { e as GuardRef, G as Guard } from '../types-CrDxFfBx.js';

/** Logical AND over guards. Short-circuits on the first `false`. */
declare function and<Ctx, Evt>(items: readonly GuardRef<Ctx, Evt>[]): Guard<Ctx, Evt>;
/** Logical OR over guards. Short-circuits on the first `true`. */
declare function or<Ctx, Evt>(items: readonly GuardRef<Ctx, Evt>[]): Guard<Ctx, Evt>;
/** Logical NOT. */
declare function not<Ctx, Evt>(item: GuardRef<Ctx, Evt>): Guard<Ctx, Evt>;
/**
 * Predicate that passes when the current state value is one of the listed
 * states. Reads `args.value`, which `evalGuard` threads from the live
 * snapshot. When called outside of `evalGuard` (e.g. unit tests), `value` is
 * `undefined` and the guard returns `false`.
 */
declare function stateIn<Ctx, Evt>(...states: readonly string[]): Guard<Ctx, Evt>;

export { and, not, or, stateIn };
