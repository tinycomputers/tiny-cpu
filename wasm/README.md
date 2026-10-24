# wasm/

`spike/` is the Phase 0 proof that Verilator + Emscripten work here, including two Verilated
models (distinct `--prefix`) in one module. Phase 5 adds `harness.cpp`, `bindings.cpp`, `build.sh`.

```bash
bash wasm/spike/build.sh && node wasm/spike/test.mjs
```
