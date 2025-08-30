import { OpenAPIRoute } from "chanfana";
import { AppContext, MarbleQuery, ColorPreset } from "../types";
import { z } from "zod";
import * as PImage from "pureimage";
import { PassThrough } from "stream";

const colorPresets: Record<z.infer<typeof ColorPreset>, string[]> = {
  blue: ["#1e3a8a", "#3b82f6", "#93c5fd"],
  red: ["#7f1d1d", "#ef4444", "#fca5a5"],
  green: ["#064e3b", "#10b981", "#6ee7b7"],
  purple: ["#581c87", "#a855f7", "#d8b4fe"],
};

function xmur3(str: string) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return function () {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return (h ^= h >>> 16) >>> 0;
  };
}

function mulberry32(a: number) {
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function getDimensions(size: string) {
  switch (size) {
    case "16:9":
      return { width: 1600, height: 900 };
    case "9:16":
      return { width: 900, height: 1600 };
    default:
      return { width: 1000, height: 1000 };
  }
}

export class MarbleImage extends OpenAPIRoute {
  schema = {
    summary: "Generate a marble pattern image",
    request: {
      query: MarbleQuery,
    },
    responses: {
      200: {
        description: "PNG marble image",
        content: {
          "image/png": {
            schema: {
              type: "string",
              format: "binary",
            },
          },
        },
      },
    },
  } as const;

  async handle(c: AppContext) {
    const { query } = await this.getValidatedData<typeof this.schema>();
    const { color, datetime, username, size } = query;

    const ts = datetime ? new Date(datetime).getTime() : Date.now();
    const seedStr = `${username ?? ""}${ts}`;
    const seed = xmur3(seedStr)();
    const rand = mulberry32(seed);

    const { width, height } = getDimensions(size);
    const img = PImage.make(width, height);
    const ctx = img.getContext("2d");

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);

    const palette = colorPresets[color];
    for (let i = 0; i < 800; i++) {
      ctx.fillStyle = palette[Math.floor(rand() * palette.length)];
      const x = rand() * width;
      const y = rand() * height;
      const r = rand() * Math.min(width, height) * 0.1;
      ctx.globalAlpha = 0.5;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    const stream = new PassThrough();
    const chunks: Buffer[] = [];
    stream.on("data", (chunk) => chunks.push(chunk));
    const pngPromise = PImage.encodePNGToStream(img, stream);
    await pngPromise;
    const buffer = Buffer.concat(chunks);
    return new Response(buffer, {
      headers: {
        "Content-Type": "image/png",
        "Content-Disposition": 'attachment; filename="marble.png"',
      },
    });
  }
}

export default MarbleImage;
