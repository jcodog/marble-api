import { DateTime, Str } from "chanfana";
import type { Context } from "hono";
import { z } from "zod";

export type AppContext = Context<{ Bindings: Env }>;

export const ColorPreset = z
  .enum(["white", "black", "blue", "red"]) // primary color presets
  .default("black");

export const MarbleQuery = z.object({
  color: ColorPreset,
  datetime: DateTime().optional(),
  username: Str({ required: false }),
  size: z.enum(["16:9", "9:16", "1:1"]).default("1:1"),
  // Optional output resolution scaling without changing the internal pattern
  // native = default internal resolution; 2k/4k/8k pick standard UHD sizes based on aspect ratio
  resolution: z.enum(["native", "2k", "4k", "8k"]).default("native").optional(),
  // Optional sharpening toggle as a query-friendly string
  sharp: z.enum(["true", "false"]).default("false").optional(),
});

export type MarbleQuery = z.infer<typeof MarbleQuery>;
