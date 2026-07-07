// Properly initializes ternlight's WASM engine for browser use.
// The WASM module imports from './tern_engine_bg.js' (its JS bindings).
// We fetch the WASM, instantiate it with those bindings, then wire it up.

import * as bgModule from '/tern_engine_bg.js';

let ready = false;
let pending = null;

export async function init() {
  if (ready) return;
  if (pending) return pending;

  pending = (async () => {
    const resp = await fetch('/tern_engine_bg.wasm');
    const { instance } = await WebAssembly.instantiateStreaming(resp, {
      './tern_engine_bg.js': bgModule,
    });
    bgModule.__wbg_set_wasm(instance.exports);
    instance.exports.__wbindgen_start();
    ready = true;
  })();

  return pending;
}

export function embed(text) {
  return bgModule.embed(text);
}
