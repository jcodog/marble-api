import { OpenAPIRoute } from "chanfana";
// PNG rendering from SVG (WASM)
import { Resvg, initWasm } from "@resvg/resvg-wasm";
// eslint-disable-next-line import/default
import resvgWasm from "@resvg/resvg-wasm/index_bg.wasm";
import { AppContext, MarbleQuery, ColorPreset } from "../types";
import { z } from "zod";

// Primary -> secondary mapping as requested
// white (primary) and black; black (primary) and gold; blue (primary) and purple; red (primary) and black
const colorPairs: Record<
  z.infer<typeof ColorPreset>,
  { base: string; vein: string }
> = {
  white: { base: "#ffffff", vein: "#0a0a0a" }, // white marble with black veins
  black: { base: "#0b0b0b", vein: "#d4af37" }, // black marble with gold veins
  blue: { base: "#1e3a8a", vein: "#7c3aed" }, // deep blue with purple veins
  red: { base: "#7f1d1d", vein: "#111111" }, // rich red with black veins
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
        description: "Marble image (SVG or PNG)",
        content: {
          "image/svg+xml": {
            schema: {
              type: "string",
              format: "binary",
            },
          },
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
    const {
      color,
      datetime,
      username,
      size,
      resolution: resOpt,
      sharp: sharpOpt,
      type: typeOpt,
    } = query as any;

    const ts = datetime ? new Date(datetime).getTime() : Date.now();
    const seedStr = `${username ?? ""}${ts}`;
    const seed = xmur3(seedStr)();
    const rand = mulberry32(seed);

    const { width, height } = getDimensions(size);
    const pair = colorPairs[color];
    // Parse optional flags
    const resolution = (resOpt as string) ?? "native";
    const sharp = ((sharpOpt as string) ?? "false") === "true";
    const outType = (typeOpt as string) ?? "svg";

    // Seed-based parameters for turbulence to make the pattern deterministic per username+time
    const baseFreq = 0.005 + rand() * 0.01; // low freq for broad waves
    const octaves = 3 + Math.floor(rand() * 3); // 3-5
    const seedNoise = Math.floor(rand() * 4096);
    const rotate = Math.floor(rand() * 360);
    const contrast = 0.6 + rand() * 0.6; // 0.6-1.2 controls vein contrast

    // Style tweaks per primary color to control dominance and vein thickness
    const isBlack = color === "black";
    const isWhite = color === "white";
    const veinOpacity1 = isBlack
      ? (0.35 + rand() * 0.1).toFixed(2)
      : isWhite
      ? (0.35 + rand() * 0.15).toFixed(2)
      : (0.22 + rand() * 0.1).toFixed(2);
    const veinOpacity2 = isBlack
      ? (0.2 + rand() * 0.08).toFixed(2)
      : isWhite
      ? (0.18 + rand() * 0.1).toFixed(2)
      : (0.1 + rand() * 0.08).toFixed(2);
    // Anisotropic base frequencies (fx fy) to elongate features
    const warpFx = (baseFreq * 0.35).toFixed(4);
    const warpFy = (baseFreq * 1.4).toFixed(4);
    const veinFx = (baseFreq * 1.6).toFixed(4);
    const veinFy = (baseFreq * 0.9).toFixed(4);
    // A second set for a distinct layer
    const warpFx2 = (baseFreq * 0.45).toFixed(4);
    const warpFy2 = (baseFreq * 1.2).toFixed(4);
    const veinFx2 = (baseFreq * 1.3).toFixed(4);
    const veinFy2 = (baseFreq * 1.0).toFixed(4);

    // Dynamic table threshold: a visible-width band of 1s among 32 entries
    // Pulsed band table to create multiple thin veins across the image
    const tableValues = (() => {
      const entries = 64;
      const pulses = 10 + Math.floor(rand() * 6); // 10-15 pulses
      const widthFrac = 0.12 + rand() * 0.06; // 0.12-0.18 pulse width
      const vals: string[] = [];
      for (let i = 0; i < entries; i++) {
        const x = i / (entries - 1);
        const phase = (x * pulses) % 1; // 0..1 within each pulse
        const on = Math.abs(phase - 0.5) * 2 < widthFrac;
        vals.push(on ? "1" : "0");
      }
      return vals.join(" ");
    })();

    // We paint a base slab and overlay thin, flowing veins:
    // - Build a thin mask from high-contrast turbulence, threshold to sparse lines
    // - Warp that mask with low-frequency anisotropic noise to create marble-like flow
    // - Apply the mask as alpha to a vein-colored rect and layer it at low opacity
    // Output scaling: keep viewBox fixed to internal width/height, scale the outer size only
    const { width: outW, height: outH } = (() => {
      switch (resolution) {
        case "4k":
          if (size === "16:9") return { width: 3840, height: 2160 };
          if (size === "9:16") return { width: 2160, height: 3840 };
          return { width: 3840, height: 3840 };
        case "2k":
          if (size === "16:9") return { width: 2560, height: 1440 };
          if (size === "9:16") return { width: 1440, height: 2560 };
          return { width: 2048, height: 2048 };
        case "8k":
          if (size === "16:9") return { width: 7680, height: 4320 };
          if (size === "9:16") return { width: 4320, height: 7680 };
          return { width: 7680, height: 7680 };
        default:
          return { width, height };
      }
    })();

    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${outW}" height="${outH}" viewBox="0 0 ${width} ${height}">
  <defs>
    <!-- Optional subtle sharpen to increase edge clarity without adding noise -->
    <filter id="postsharp" x="-2%" y="-2%" width="104%" height="104%" color-interpolation-filters="sRGB">
      <feConvolveMatrix order="3" kernelMatrix="0 -1 0 -1 5 -1 0 -1 0" divisor="1" preserveAlpha="true"/>
    </filter>
    <filter id="veinFilter" x="-40%" y="-40%" width="180%" height="180%" color-interpolation-filters="sRGB">
        <!-- Low-frequency anisotropic noise used as a warp field -->
        <feTurbulence type="fractalNoise" baseFrequency="${warpFx} ${warpFy}" numOctaves="${octaves}" seed="${seedNoise}" result="warpMap"/>

        <!-- High-contrast, anisotropic noise narrowed to thin segments -->
        <feTurbulence type="fractalNoise" baseFrequency="${veinFx} ${veinFy}" numOctaves="${
      2 + Math.floor(rand() * 2)
    }" seed="${(seedNoise + 137) % 4096}" result="veinNoise"/>
        <feColorMatrix in="veinNoise" type="saturate" values="0" result="veinGray"/>
        <feComponentTransfer in="veinGray" result="veinContrast">
          <feFuncR type="gamma" amplitude="1" exponent="${(
            2.2 +
            rand() * 1.5
          ).toFixed(2)}" offset="0"/>
          <feFuncG type="gamma" amplitude="1" exponent="${(
            2.2 +
            rand() * 1.5
          ).toFixed(2)}" offset="0"/>
          <feFuncB type="gamma" amplitude="1" exponent="${(
            2.2 +
            rand() * 1.5
          ).toFixed(2)}" offset="0"/>
        </feComponentTransfer>
        <!-- Moderate band threshold to reveal visible veins -->
        <feComponentTransfer in="veinContrast" result="veinMask0">
          <feFuncR type="table" tableValues="${tableValues}"/>
          <feFuncG type="table" tableValues="${tableValues}"/>
          <feFuncB type="table" tableValues="${tableValues}"/>
        </feComponentTransfer>

        <!-- Warp and thin the mask to create flowing veins -->
        <feDisplacementMap in="veinMask0" in2="warpMap" xChannelSelector="R" yChannelSelector="G" scale="${Math.round(
          40 + rand() * 80
        )}" result="veinMask1"/>
        <feGaussianBlur in="veinMask1" stdDeviation="${(
          0.8 +
          rand() * 0.8
        ).toFixed(2)}" result="veinMaskSoft"/>
        <feColorMatrix in="veinMaskSoft" type="luminanceToAlpha" result="veinAlpha"/>
        <!-- Boost alpha so veins remain visible over dark bases -->
        <feComponentTransfer in="veinAlpha" result="veinAlpha">
          <feFuncA type="gamma" amplitude="1" exponent="0.7" offset="0"/>
        </feComponentTransfer>

        <!-- Apply alpha to the vein-colored rect only where veins exist -->
        <feComposite in="SourceGraphic" in2="veinAlpha" operator="in"/>
    </filter>

    <!-- Second vein filter for a different layer (different seeds and frequencies) -->
    <filter id="veinFilter2" x="-40%" y="-40%" width="180%" height="180%" color-interpolation-filters="sRGB">
        <feTurbulence type="fractalNoise" baseFrequency="${warpFx2} ${warpFy2}" numOctaves="${octaves}" seed="${
      (seedNoise + 251) % 4096
    }" result="warpMap2"/>
        <feTurbulence type="fractalNoise" baseFrequency="${veinFx2} ${veinFy2}" numOctaves="${
      2 + Math.floor(rand() * 2)
    }" seed="${(seedNoise + 587) % 4096}" result="veinNoise2"/>
        <feColorMatrix in="veinNoise2" type="saturate" values="0" result="veinGray2"/>
        <feComponentTransfer in="veinGray2" result="veinMask0b">
          <feFuncR type="table" tableValues="${tableValues}"/>
          <feFuncG type="table" tableValues="${tableValues}"/>
          <feFuncB type="table" tableValues="${tableValues}"/>
        </feComponentTransfer>
        <feDisplacementMap in="veinMask0b" in2="warpMap2" xChannelSelector="R" yChannelSelector="G" scale="${Math.round(
          55 + rand() * 65
        )}" result="veinMask2"/>
        <feGaussianBlur in="veinMask2" stdDeviation="${(
          0.7 +
          rand() * 1.1
        ).toFixed(2)}" result="veinMaskSoft2"/>
        <feColorMatrix in="veinMaskSoft2" type="luminanceToAlpha" result="veinAlpha2"/>
        <feComposite in="SourceGraphic" in2="veinAlpha2" operator="in"/>
    </filter>
  </defs>

  ${sharp ? '<g filter="url(#postsharp)">' : "<g>"}
    <!-- Base slab color -->
    <rect width="100%" height="100%" fill="${pair.base}"/>

    <!-- Veins: full coverage (no rotation to avoid edge artifacts) -->
    <rect width="100%" height="100%" fill="${
      pair.vein
    }" filter="url(#veinFilter)" opacity="${veinOpacity1}"/>
    <!-- Subtle additional veining layer for richness -->
    <rect width="100%" height="100%" fill="${
      pair.vein
    }" filter="url(#veinFilter2)" opacity="${veinOpacity2}"/>
  </g>
</svg>`;

    if (outType === "png") {
      try {
        // Initialize WASM (no-op if already initialized in this worker instance)
        await initWasm(resvgWasm as ArrayBuffer);
        // Rendering very large PNGs can exceed Workers memory limits. Cap for safety.
        const maxDim = 4096;
        let targetW = outW;
        let targetH = outH;
        if (targetW > maxDim || targetH > maxDim) {
          const scale = Math.min(maxDim / targetW, maxDim / targetH);
          targetW = Math.max(1, Math.floor(targetW * scale));
          targetH = Math.max(1, Math.floor(targetH * scale));
        }
        const renderer = new Resvg(svg, {
          fitTo: { mode: "width", value: targetW },
          background: "transparent",
        } as any);
        const rendered = renderer.render();
        const png = rendered.asPng();
        return new Response(png, {
          headers: {
            "Content-Type": "image/png",
            "Cache-Control": "no-store",
            "Content-Disposition": 'attachment; filename="marble.png"',
          },
        });
      } catch (err) {
        // Fallback to SVG if PNG rasterization fails
        console.error(err)
        return new Response(svg, {
          headers: {
            "Content-Type": "image/svg+xml",
            "Content-Disposition": 'attachment; filename="marble.svg"',
            "X-Marble-PNG-Fallback": "true",
          },
        });
      }
    }

    return new Response(svg, {
      headers: {
        "Content-Type": "image/svg+xml",
        "Content-Disposition": 'attachment; filename="marble.svg"',
      },
    });
  }
}

export default MarbleImage;
