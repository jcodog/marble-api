import { DateTime, Str } from "chanfana";
import type { Context } from "hono";
import { z } from "zod";

export type AppContext = Context<{ Bindings: Env }>;

export const Task = z.object({
        name: Str({ example: "lorem" }),
        slug: Str(),
        description: Str({ required: false }),
        completed: z.boolean().default(false),
        due_date: DateTime(),
});

export const ColorPreset = z
  .enum(["blue", "red", "green", "purple"])
  .default("blue");

export const MarbleQuery = z.object({
  color: ColorPreset,
  datetime: DateTime().optional(),
  username: Str({ required: false }),
  size: z.enum(["16:9", "9:16", "1:1"]).default("1:1"),
});

export type MarbleQuery = z.infer<typeof MarbleQuery>;
