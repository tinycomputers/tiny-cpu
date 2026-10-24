// Headless check of the spike build: both models count independently.
// Usage: node wasm/spike/test.mjs   (after bash wasm/spike/build.sh)
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const dir = join(dirname(fileURLToPath(import.meta.url)), "../../web/public/spike");
const { default: create } = await import(join(dir, "counter.mjs"));
const mod = await create();

const a = new mod.CounterSimA();
const b = new mod.CounterSimB();
a.reset();
b.reset();
const ra = [];
const rb = [];
for (let i = 0; i < 5; i++) a.step(), ra.push(a.getCount());
for (let i = 0; i < 3; i++) b.step(), rb.push(b.getCount());
a.delete();
b.delete();

const ok = JSON.stringify(ra) === "[1,2,3,4,5]" && JSON.stringify(rb) === "[1,2,3]";
console.log(`A: ${ra}  B: ${rb}  ->  ${ok ? "PASS" : "FAIL"}`);
process.exit(ok ? 0 : 1);
