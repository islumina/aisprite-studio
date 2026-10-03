import * as z from "zod/v4";
export declare const ASSET_ID: RegExp;
export declare const RequestSchema: z.ZodObject<{
    character: z.ZodOptional<z.ZodString>;
    style: z.ZodDefault<z.ZodString>;
    frame_size: z.ZodDefault<z.ZodNumber>;
    asset_type: z.ZodDefault<z.ZodEnum<{
        character: "character";
        effect: "effect";
        object: "object";
    }>>;
    animations: z.ZodArray<z.ZodObject<{
        action: z.ZodString;
        direction: z.ZodDefault<z.ZodString>;
        frames: z.ZodDefault<z.ZodNumber>;
        fps: z.ZodOptional<z.ZodNumber>;
    }, z.core.$strict>>;
}, z.core.$loose>;
export type AssetRequest = z.infer<typeof RequestSchema>;
export interface FrameSpec {
    name: string;
    animation: string;
    action: string;
    direction: string;
    index: number;
    total: number;
}
export declare function animationName(action: string, direction: string): string;
export declare function frameName(action: string, direction: string, index: number): string;
export declare function frameSpecs(request: AssetRequest): FrameSpec[];
