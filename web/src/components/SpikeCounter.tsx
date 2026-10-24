import { useEffect, useState } from "react";
import { loadSpike } from "@/lib/spike-loader";

type Result =
  | { status: "loading" }
  | { status: "pass" | "fail"; a: number[]; b: number[] }
  | { status: "error"; message: string };

export default function SpikeCounter() {
  const [result, setResult] = useState<Result>({ status: "loading" });

  useEffect(() => {
    loadSpike()
      .then((mod) => {
        const a = new mod.CounterSimA();
        const b = new mod.CounterSimB();
        a.reset();
        b.reset();
        const ra: number[] = [];
        const rb: number[] = [];
        for (let i = 0; i < 5; i++) {
          a.step();
          ra.push(a.getCount());
        }
        for (let i = 0; i < 3; i++) {
          b.step();
          rb.push(b.getCount());
        }
        a.delete();
        b.delete();
        const ok = ra.join() === "1,2,3,4,5" && rb.join() === "1,2,3";
        setResult({ status: ok ? "pass" : "fail", a: ra, b: rb });
      })
      .catch((e: unknown) =>
        setResult({
          status: "error",
          message:
            (e instanceof Error ? e.message : String(e)) +
            " - run `bash wasm/spike/build.sh` first.",
        })
      );
  }, []);

  const color =
    result.status === "pass"
      ? "var(--ok)"
      : result.status === "loading"
        ? "var(--muted)"
        : "var(--err)";

  return (
    <pre
      className="mt-6 rounded-md p-4 text-lg"
      style={{ background: "var(--panel)", color }}
      data-testid="spike-output"
    >
      {result.status === "loading" && "Loading WASM..."}
      {result.status === "error" && `ERROR: ${result.message}`}
      {(result.status === "pass" || result.status === "fail") &&
        `${result.status.toUpperCase()} - A: ${result.a.join(" ")} | B: ${result.b.join(" ")}`}
    </pre>
  );
}
