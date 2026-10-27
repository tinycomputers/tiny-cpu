import { useMemo, useState } from "react";
import { comparePresets } from "../lib/programs-compare";
import { accessCounts } from "../lib/run-model";
import { cyclesToMicroseconds, ICE40_FMAX_MHZ } from "../lib/fpga";
import type { TinyCpuModule } from "../lib/wasm-loader";
import { Heatmap } from "./Heatmap";

export function ProgramsView({ mod }: { mod: TinyCpuModule | null }) {
  const rows = useMemo(() => (mod ? comparePresets(mod) : []), [mod]);
  const [id, setId] = useState("sort");
  const chosen = rows.find((r) => r.id === id) ?? rows[0];

  const counts = useMemo(() => (chosen ? accessCounts(chosen.pipeRun.states, chosen.dmem.length) : null), [chosen]);
  const usedWords = chosen ? Math.min(256, Math.max(16, Math.ceil(chosen.dmem.length / 4))) : 0;

  if (!mod) return <p className="text-sm text-[var(--muted)]">Loading the core…</p>;
  return (
    <div className="flex flex-col gap-4">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] border-collapse font-mono text-sm">
          <thead>
            <tr className="text-left text-[var(--muted)]">
              <th className="py-1 font-normal">program</th>
              <th className="py-1 text-right font-normal">instructions</th>
              <th className="py-1 text-right font-normal">single-cycle</th>
              <th className="py-1 text-right font-normal">pipeline</th>
              <th className="py-1 text-right font-normal" title={`iCE40UP5K at ${ICE40_FMAX_MHZ} MHz (post-route)`}>
                time on iCE40
              </th>
              <th className="py-1 text-right font-normal">pipeline CPI</th>
              <th className="py-1 text-right font-normal">stalls</th>
              <th className="py-1 text-right font-normal">flushes</th>
              <th className="py-1 text-right font-normal">result</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-[var(--line)]" style={{ background: r.id === chosen?.id ? "var(--active)" : undefined }}>
                <td className="py-1">
                  <button className="text-left underline-offset-2 hover:underline" onClick={() => setId(r.id)} aria-pressed={r.id === chosen?.id}>
                    {r.title}
                  </button>
                </td>
                <td className="py-1 text-right">{r.instructions}</td>
                <td className="py-1 text-right">{r.singleCycles}</td>
                <td className="py-1 text-right">{r.pipeCycles}</td>
                <td className="py-1 text-right">{cyclesToMicroseconds(r.pipeCycles).toFixed(1)} µs</td>
                <td className="py-1 text-right">{r.pipeCpi.toFixed(2)}</td>
                <td className="py-1 text-right">{r.stalls}</td>
                <td className="py-1 text-right">{r.flushes}</td>
                <td className="py-1 text-right" style={{ color: r.pass ? "var(--ok)" : "var(--err)" }}>
                  {r.pass ? "PASS" : "FAIL"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-[var(--muted)]">
        Single-cycle cycles equal the instruction count. The pipeline&apos;s cycle count is what the same program takes with forwarding on.
        Time on an iCE40UP5K is cycles divided by the post-route clock of the pipeline (see the README&apos;s FPGA section).
      </p>
      {chosen && counts && (
        <div className="flex flex-col gap-2">
          <h3 className="font-semibold text-[var(--fg)]">Data memory: {chosen.title}</h3>
          <Heatmap reads={counts.reads} writes={counts.writes} words={usedWords} />
        </div>
      )}
    </div>
  );
}
