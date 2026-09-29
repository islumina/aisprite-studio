import { Sprite, Texture, Spritesheet } from 'pixi.js';
import { C as CompleteHandler, L as ListenerOptions, U as Unsubscribe, d as StateChangeHandler, b as SpriteGraph } from '../types-Dr7yXTRQ.js';

/**
 * Thrown by {@link createPixiSpriteAnimator} when the supplied textures are
 * missing one or more frame keys the graph's animations reference (an own entry
 * whose value is `null` / `undefined` counts as missing, and so does every key
 * when `textures` itself is nullish). Fail-fast at construction, so `update()`
 * never has to guard.
 *
 * @public
 */
declare class MissingTextureError extends Error {
    readonly keys: readonly string[];
    constructor(keys: readonly string[]);
}
/** Frame-key → texture lookup. A PixiJS `Spritesheet` exposes one as `.textures`. */
type TextureMap = Record<string, Texture>;
/**
 * Options for {@link createPixiSpriteAnimator}.
 *
 * @public
 */
interface PixiSpriteAnimatorOptions {
    /**
     * Apply each frame's atlas anchor (`texture.defaultAnchor`) to the sprite when
     * the frame changes — preserving non-centre / foot pivots. Default `true`.
     * Set `false` to manage the anchor yourself.
     */
    readonly applyAnchor?: boolean;
}
/**
 * A PixiJS-bound animator: the core machine plus a sprite whose texture tracks
 * the active frame.
 *
 * @public
 */
interface PixiSpriteAnimator {
    /** The bound sprite, updated in place. */
    readonly sprite: Sprite;
    /**
     * Run the core machine for `deltaMs`, then sync the sprite's texture (also
     * when a listener throws, before the error propagates).
     */
    update(deltaMs: number): void;
    /** Set a Number / Boolean input on the core machine. */
    setInput(name: string, value: number | boolean): void;
    /** Fire a Trigger on the core machine. */
    fireTrigger(name: string): void;
    /** Reset the core machine and re-sync the sprite. */
    reset(): void;
    /** Dispose the core machine. Idempotent. Does not destroy the sprite. */
    dispose(): void;
    /** Current state name. */
    readonly activeState: string;
    /** Current frame key. */
    readonly activeFrameKey: string;
    /** `true` once disposed. */
    readonly disposed: boolean;
    /** Subscribe to non-looping clip completions. Returns an unsubscribe. */
    onComplete(handler: CompleteHandler, options?: ListenerOptions): Unsubscribe;
    /** Subscribe to state changes. Returns an unsubscribe. */
    onStateChange(handler: StateChangeHandler, options?: ListenerOptions): Unsubscribe;
}
/**
 * Bind an input-driven {@link SpriteGraph} to a PixiJS `Sprite`.
 *
 * @param sprite - a plain `Sprite` to drive; its `texture` (and, by default,
 *   `anchor`) are updated in place. The adapter owns frame selection, so if a
 *   *playing* `AnimatedSprite` is passed (it extends `Sprite`), its internal
 *   playback is stopped to stop it fighting the adapter for the texture.
 * @param graph - the input-driven graph (same shape the core consumes).
 * @param textures - a `Spritesheet` or a frame-key → `Texture` map covering
 *   every frame of every declared animation. Any object with an object-valued
 *   `textures` property is read as a Spritesheet, so if a frame is literally
 *   named `textures`, pass the Spritesheet (or `{ textures: map }`), not the
 *   bare map.
 * @param options - see {@link PixiSpriteAnimatorOptions}.
 * @returns a {@link PixiSpriteAnimator}.
 * @throws {@link InvalidGraphError} if the graph is not an object or its
 *   containers are malformed (checked before textures), or is otherwise invalid.
 * @throws {@link MissingTextureError} if a frame key has no texture, or a
 *   `null` / `undefined` one.
 *
 * @public
 */
declare function createPixiSpriteAnimator(sprite: Sprite, graph: SpriteGraph, textures: Spritesheet | TextureMap, options?: PixiSpriteAnimatorOptions): PixiSpriteAnimator;

export { MissingTextureError, type PixiSpriteAnimator, type PixiSpriteAnimatorOptions, type TextureMap, createPixiSpriteAnimator };
