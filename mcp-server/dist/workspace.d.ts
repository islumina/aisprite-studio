import { type RowLayout } from "./prompts.js";
import { type AssetRequest, type FrameSpec } from "./request.js";
export { animationName, frameName, frameSpecs, type AssetRequest, type FrameSpec } from "./request.js";
export { poseFor, type RowLayout } from "./prompts.js";
export interface AssetSummary {
    name: string;
    asset_type: AssetRequest["asset_type"];
    frame_size: number;
    expected_frames: number;
    generated_frames: number;
    qa_status: string;
    has_reference: boolean;
}
export interface GenerationTask {
    asset: string;
    frame: FrameSpec;
    request: AssetRequest;
    prompt: string;
    reference_paths: string[];
}
export interface AnimationOutline {
    asset: string;
    animation: string;
    frames: {
        name: string;
        pose: string;
    }[];
    prompt: string;
}
export interface RowTask {
    asset: string;
    animation: string;
    frames: string[];
    layout: RowLayout;
    upscale: number;
    warning: string | null;
    prompt: string;
    reference_paths: string[];
}
export interface ReferenceTask {
    asset: string;
    request: AssetRequest;
    prompt: string;
    reference_paths: string[];
    known_asset_status: string;
    reference_warning: string;
}
export declare function assetDirectory(root: string, asset: string): string;
export declare function loadRequest(root: string, asset: string): Promise<AssetRequest>;
export declare function listAssets(root: string): Promise<AssetSummary[]>;
export declare function getReferenceTask(root: string, asset: string): Promise<ReferenceTask>;
export declare function getGenerationTask(root: string, asset: string, requestedFrame?: string): Promise<GenerationTask>;
export declare function getAnimationOutline(root: string, asset: string, animation: string): Promise<AnimationOutline>;
export declare function getPendingTasks(root: string, asset: string): Promise<GenerationTask[]>;
export declare function parsePng(buffer: Buffer): {
    width: number;
    height: number;
};
export declare function submitFrame(root: string, asset: string, frameName: string, encoded: string, replace: boolean): Promise<{
    path: string;
    bytes: number;
    width: number;
    height: number;
}>;
export declare function submitReference(root: string, asset: string, encoded: string, replace: boolean): Promise<{
    path: string;
    bytes: number;
    width: number;
    height: number;
}>;
export declare function getRowTask(root: string, asset: string, requestedAnimation?: string): Promise<RowTask>;
export declare function submitRow(root: string, asset: string, animation: string, encoded: string, replace: boolean): Promise<{
    raw: string;
    frames: string[];
    scale: number;
}>;
export declare function runDeterministicQa(root: string, asset: string): Promise<{
    exit_code: number;
    output: string;
}>;
export interface QaSummary {
    overall: string;
    score: number | null;
    animations: Record<string, {
        score: number;
        hints: string[];
        more_hints: number;
    }>;
    failing_frames: {
        frame: string;
        status: string;
        repair_hint: string | null;
    }[];
    failing_frame_count: number;
    visual_review: string;
}
export declare function summariseQaReport(report: unknown): QaSummary;
export declare function readQaReport(root: string, asset: string): Promise<unknown>;
