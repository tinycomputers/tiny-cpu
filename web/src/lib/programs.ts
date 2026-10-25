// Example programs shown in the app. Each is plain RV32I assembly (src/lib/presets/*.s), checked on the
// WASM core by src/lib/__tests__/wasm.integration.test.ts and against GNU by gnu-asm.test.ts.
import fib from "./presets/fib.s?raw";
import hello from "./presets/hello.s?raw";
import memcpy from "./presets/memcpy.s?raw";
import primes from "./presets/primes.s?raw";
import sort from "./presets/sort.s?raw";

export interface Preset {
  id: string;
  title: string;
  description: string;
  source: string;
  output: string;
}

export const PRESETS: Preset[] = [
  { id: "hello", title: "Hello", description: "Prints a string with a byte loop and a call.", source: hello, output: "Hello, TinyCPU!\n" },
  { id: "fib", title: "Fibonacci", description: "fib(20) in a loop, printed in decimal by repeated subtraction.", source: fib, output: "6765\n" },
  { id: "sort", title: "Bubble sort", description: "Sorts 12 words in data memory, then prints them. Data hazards everywhere.", source: sort, output: "1 3 5 7 11 18 27 42 50 64 85 99 \n" },
  { id: "memcpy", title: "memcpy", description: "Byte copy, then a word-by-word check that prints OK.", source: memcpy, output: "OK\n" },
  { id: "primes", title: "Primes", description: "Sieve of Eratosthenes up to 60.", source: primes, output: "2 3 5 7 11 13 17 19 23 29 31 37 41 43 47 53 59 \n" },
];
