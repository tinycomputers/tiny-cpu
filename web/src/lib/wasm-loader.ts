// Loads the tiny_cpu WebAssembly module once per page. The URL is a parameter so the same code runs in
// the browser (served from /public) and in Node tests (an absolute file URL).
import type { CoreName, CycleState, RunSummary } from "./state-schema";

/** Raw embind surface of TinyCpuSim (wasm/bindings.cpp). */
export interface RawSim {
  reset(core: string): boolean;
  setForwarding(on: boolean): void;
  loadImem(words: ArrayLike<number>): boolean;
  loadDmem(bytes: ArrayLike<number>): boolean;
  start(): void;
  run(maxCycles: number): CycleState[];
  runFast(maxCycles: number): RunSummary;
  getRegs(): number[];
  readDmem(addr: number, len: number): number[];
  getConsole(): string;
  getCycleCount(): number;
  isHalted(): boolean;
  isFault(): boolean;
  delete(): void;
}

export interface TinyCpuModule {
  TinyCpuSim: new () => RawSim;
}

let modulePromise: Promise<TinyCpuModule> | undefined;

export function loadTinyCpu(url: string): Promise<TinyCpuModule> {
  if (!modulePromise) {
    modulePromise = import(/* @vite-ignore */ url).then(async (m: { default: () => Promise<TinyCpuModule> }) =>
      m.default(),
    );
    modulePromise.catch(() => {
      modulePromise = undefined; // allow a retry after a failed load
    });
  }
  return modulePromise;
}

export type { CoreName };
