// request.yml schema and the frame list it declares. Frame names must match
// tools/sprite_pipeline/spec.py; tests/spec-parity.test.mjs checks both.
import * as z from "zod/v4";

export const ASSET_ID = /^[A-Za-z0-9_-]{1,80}$/;

const AnimationSchema = z.object({
  action: z.string().regex(ASSET_ID),
  // Empty for subjects without a facing (fish, effects): frames are then `swim_00`.
  direction: z.string().regex(/^[A-Za-z0-9_-]{0,80}$/).default(""),
  frames: z.number().int().min(1).max(240).default(4),
  fps: z.number().int().min(1).max(60).optional(),
}).strict();

export const RequestSchema = z.object({
  character: z.string().regex(ASSET_ID).optional(),
  style: z.string().min(1).max(500).default("3d cartoon game style"),
  frame_size: z.number().int().min(16).max(4096).default(512),
  asset_type: z.enum(["character", "object", "effect"]).default("character"),
  animations: z.array(AnimationSchema).min(1).max(100),
}).passthrough();

export type AssetRequest = z.infer<typeof RequestSchema>;

export interface FrameSpec {
  name: string;
  animation: string;
  action: string;
  direction: string;
  index: number;
  total: number;
}

export function animationName(action: string, direction: string): string {
  return direction ? `${action}_${direction}` : action;
}

export function frameName(action: string, direction: string, index: number): string {
  return `${animationName(action, direction)}_${String(index).padStart(2, "0")}`;
}

export function frameSpecs(request: AssetRequest): FrameSpec[] {
  return request.animations.flatMap((animation) => Array.from(
    { length: animation.frames },
    (_, index) => ({
      name: frameName(animation.action, animation.direction, index),
      animation: animationName(animation.action, animation.direction),
      action: animation.action,
      direction: animation.direction,
      index,
      total: animation.frames,
    }),
  ));
}
