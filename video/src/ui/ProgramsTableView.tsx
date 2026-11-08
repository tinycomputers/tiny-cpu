// Presentational copy of web/src/components/ProgramsView.tsx (same markup and classes) fed with real run results.
import React from "react";
import { Heatmap } from "@web/components/Heatmap";
import { FMAX_MHZ, PROGRAMS } from "./runData";

export function ProgramsTableView({ id, heatProgress = 1 }: { id: string; heatProgress?: number }) {
  const chosen = PROGRAMS.find((r) => r.id === id) ?? PROGRAMS[0];
  if (!chosen) return null;
  const words = chosen.heat.words;
  // reveal the heat map progressively so the video can "paint" it; progress 1 = the real final map
  const shown = Math.round(words * heatProgress);
  const reads = Uint32Array.from(chosen.heat.reads.map((v, i) => (i < shown ? v : 0)));
  const writes = Uint32Array.from(chosen.heat.writes.map((v, i) => (i < shown ? v : 0)));
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
              <th className="py-1 text-right font-normal" title={`iCE40UP5K at ${FMAX_MHZ} MHz (post-route)`}>
                time on iCE40
              </th>
              <th className="py-1 text-right font-normal">pipeline CPI</th>
              <th className="py-1 text-right font-normal">stalls</th>
              <th className="py-1 text-right font-normal">flushes</th>
              <th className="py-1 text-right font-normal">result</th>
            </tr>
          </thead>
          <tbody>
            {PROGRAMS.map((r) => (
              <tr key={r.id} data-prow={r.id} className="border-t border-[var(--line)]" style={{ background: r.id === chosen.id ? "var(--active)" : undefined }}>
                <td className="py-1">
                  <button className="text-left underline-offset-2 hover:underline" aria-pressed={r.id === chosen.id}>
                    {r.title}
                  </button>
                </td>
                <td className="py-1 text-right">{r.instructions}</td>
                <td className="py-1 text-right">{r.singleCycles}</td>
                <td className="py-1 text-right">{r.pipeCycles}</td>
                <td className="py-1 text-right">{r.timeUs.toFixed(1)} µs</td>
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
      <div className="flex flex-col gap-2" data-heatmap>
        <h3 className="font-semibold text-[var(--fg)]">Data memory: {chosen.title}</h3>
        <Heatmap reads={reads} writes={writes} words={words} />
      </div>
    </div>
  );
}
