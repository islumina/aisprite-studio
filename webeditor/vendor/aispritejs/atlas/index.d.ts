import { I as InputDef, S as StateDef, T as TransitionDef, a as SpriteAnimator, b as SpriteGraph } from '../types-DKMFvfx9.js';

/**
 * Thrown when an atlas is structurally unusable — not an object, missing or
 * malformed `animations`, or carrying no `aispritejs` control block (and none
 * supplied separately). Semantic problems (unknown transition targets, etc.)
 * surface later as {@link InvalidGraphError} from the core.
 *
 * @public
 */
declare class InvalidAtlasError extends Error {
    constructor(message: string);
}
/**
 * The `aispritejs` input-driven control block — everything in a {@link SpriteGraph}
 * except the universal `animations` / `frames` that come from the atlas. Supply
 * this as the second argument to drive an atlas whose own `states` block is
 * foreign (event-driven) or absent.
 *
 * @public
 */
interface SpriteControl {
    readonly inputs: Readonly<Record<string, InputDef>>;
    readonly states: Readonly<Record<string, StateDef>>;
    readonly transitions: readonly TransitionDef[];
    readonly initial?: string;
    readonly defaultFrameDuration?: number;
}
/**
 * Parse a (possibly augmented) PixiJS-v8 atlas into a {@link SpriteGraph}.
 *
 * @param atlas - a parsed atlas object: `animations` (required) + optional
 *   `frames`, and — for the augmented shape — `inputs` / `states` / `transitions`.
 * @param control - an explicit {@link SpriteControl} that supplies (or overrides)
 *   the input-driven graph. Required when the atlas has no `aispritejs` control
 *   block or its `states` is foreign (event-driven).
 * @returns a {@link SpriteGraph} ready for `createSpriteAnimator`.
 * @throws {@link InvalidAtlasError} on a structurally unusable atlas.
 *
 * @public
 */
declare function parseAtlas(atlas: unknown, control?: SpriteControl): SpriteGraph;
/**
 * Parse an atlas and build a {@link SpriteAnimator} in one step — the fail-fast
 * "load" entry. Structural problems throw {@link InvalidAtlasError}; semantic
 * problems throw {@link InvalidGraphError} from the core.
 *
 * @public
 */
declare function loadAtlas(atlas: unknown, control?: SpriteControl): SpriteAnimator;

export { InvalidAtlasError, type SpriteControl, loadAtlas, parseAtlas };
