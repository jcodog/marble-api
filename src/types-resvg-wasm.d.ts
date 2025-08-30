declare module "@resvg/resvg-wasm" {
  export class Resvg {
    constructor(svg: string, opts?: any);
    render(): {
      asPng(): Uint8Array;
      asRaw(): { width: number; height: number; data: Uint8Array };
    };
  }
  export function initWasm(
    wasm: ArrayBuffer | WebAssembly.Module | Uint8Array
  ): Promise<void>;
}
