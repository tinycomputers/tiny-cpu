// Presentational copy of web/src/components/HazardLab.tsx: same markup and classes, fed with the numbers
// the real WASM core produced (scripts/gen-data.ts) instead of running the core in the browser.
import React from "react";
import { HAZARD, type HazardData } from "./runData";

const TIMELINE = 8;

function Timeline({ rows, title }: { rows: (number | null)[][]; title: string }) {
  const cols = Math.min(TIMELINE, rows.length);
  return (
    <div className="min-w-0 overflow-x-auto">
      <p className="mb-1 font-mono text-xs text-[var(--muted)]">{title}</p>
      <table className="border-collapse font-mono text-xs">
        <tbody>
          {["IF", "ID", "EX", "MEM", "WB"].map((name, row) => (
            <tr key={name} className="border-t border-[var(--line)]">
              <td className="pr-2 text-[var(--muted)]">{name}</td>
              {Array.from({ length: cols }, (_, c) => {
                const pc = rows[c]?.[row];
                const valid = pc !== null && pc !== undefined;
                return (
                  <td key={c} className="px-1.5 py-0.5 text-[var(--fg)]" style={{ opacity: valid ? 1 : 0.3 }}>
                    {valid ? (pc as number).toString(16).padStart(4, "0") : "··"}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function HazardLabView({ id, highlightRow }: { id: string; highlightRow?: number }) {
  const c: HazardData = HAZARD.find((x) => x.id === id) ?? (HAZARD[0] as HazardData);
  const base = c.rows[2]?.cycles ?? 0;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2" role="group" aria-label="Hazard cases">
        {HAZARD.map((x) => (
          <button
            key={x.id}
            aria-pressed={x.id === id}
            data-pill={x.id}
            className="rounded-full border px-3 py-1 text-sm"
            style={{ borderColor: x.id === id ? "var(--accent)" : "var(--line)", color: x.id === id ? "var(--fg)" : "var(--muted)" }}
          >
            {x.title}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="flex flex-col gap-2">
          <h3 className="font-semibold text-[var(--fg)]">{c.title}</h3>
          <p className="text-sm text-[var(--muted)]">{c.why}</p>
          <p className="text-sm text-[var(--fg)]">
            <span className="font-semibold">What to look for: </span>
            {c.expect}
          </p>
          <pre className="overflow-x-auto rounded-md bg-[var(--bg)] p-2 font-mono text-xs text-[var(--fg)]">{c.source}</pre>
        </div>

        <div className="flex min-w-0 flex-col gap-3">
          <table className="w-full border-collapse font-mono text-sm">
            <thead>
              <tr className="text-left text-[var(--muted)]">
                <th className="py-1 font-normal">configuration</th>
                <th className="py-1 text-right font-normal">cycles</th>
                <th className="py-1 text-right font-normal">stalls</th>
                <th className="py-1 text-right font-normal">flushes</th>
                <th className="py-1 text-right font-normal">vs single</th>
              </tr>
            </thead>
            <tbody>
              {c.rows.map((row, i) => {
                const d = row.cycles - base;
                const single = row.name.startsWith("single");
                return (
                  <tr key={row.name} data-hrow={i} className="border-t border-[var(--line)]" style={{ background: highlightRow === i ? "var(--active)" : undefined }}>
                    <td className="py-1 text-[var(--fg)]">{row.name}</td>
                    <td className="py-1 text-right text-[var(--fg)]">{row.cycles}</td>
                    <td className="py-1 text-right text-[var(--fg)]">{single ? "—" : row.stalls}</td>
                    <td className="py-1 text-right text-[var(--fg)]">{single ? "—" : row.flushes}</td>
                    <td className="py-1 text-right text-[var(--fg)]">{d >= 0 ? `+${d}` : d}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <Timeline rows={c.timelineFwd} title={`first ${TIMELINE} cycles, forwarding on (pc, low 16 bits)`} />
          <Timeline rows={c.timelineNoFwd} title={`first ${TIMELINE} cycles, forwarding off`} />
        </div>
      </div>
    </div>
  );
}
