import simdUrl from '@olilarkin/paulstretch-wasm/paulstretch.wasm?url';
import scalarUrl from '@olilarkin/paulstretch-wasm/paulstretch.nosimd.wasm?url';

// A minimal WASM module containing a `v128` local and a SIMD op (the canonical
// wasm-feature-detect probe). `WebAssembly.validate` returns a boolean and never
// throws, so this is safe on every engine.
const SIMD_PROBE = new Uint8Array([
  0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253,
  15, 253, 98, 11,
]);

/**
 * True if the current engine can compile a WASM module that uses SIMD.
 *
 * The production `paulstretch.wasm` is a `-msimd128` build. Some browsers can't
 * parse a SIMD module and fail to *compile* it at all (e.g. Safari before 16.4).
 * On those we must load the scalar `paulstretch.nosimd.wasm` instead.
 */
export function hasWasmSimd(): boolean {
  try {
    return typeof WebAssembly === 'object' && WebAssembly.validate(SIMD_PROBE);
  } catch {
    return false;
  }
}

// Chosen once per worker at import time. Both binaries are built with the same
// Emscripten version, so the single glue (`paulstretch.js`) drives either one —
// only the `?url` passed to `locateFile` changes.
export const wasmUrl: string = hasWasmSimd() ? simdUrl : scalarUrl;
