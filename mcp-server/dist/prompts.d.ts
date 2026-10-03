import { type AssetRequest, type FrameSpec } from "./request.js";
/** Grid of a row task, as tools/sprite_pipeline/row.py plans it. */
export interface RowLayout {
    frames: number;
    columns: number;
    rows: number;
    slot: number;
    canvas: [number, number];
}
export declare function poseFor(frame: FrameSpec): string;
export declare function framePrompt(asset: string, request: AssetRequest, frame: FrameSpec): string;
export declare const REFERENCE_WARNING = "Existing generated images are unapproved failure artifacts. Prefer input.png for identity; use tpose.png only as repair context and do not preserve its defects.";
export declare function referencePrompt(asset: string, request: AssetRequest): string;
export declare function animationPrompt(asset: string, request: AssetRequest, frames: FrameSpec[]): string;
export declare function rowPrompt(asset: string, request: AssetRequest, frames: FrameSpec[], layout: RowLayout): string;
