import { useMemo, useState } from "react";
import { HAZARD_CASES, runHazardCase } from "../lib/hazard-lab";
import { buildRunModel } from "../lib/run-model";
import type { RunResult } from "../lib/runner";
import type { TinyCpuModule } from "../lib/wasm-loader";

interface Props {
  mod: TinyCpuModule | null;
}

const TIMELINE = 8;

function Timeline({ run, title }: { run: RunResult; title: string }) {
  const cols = Math.min(TIMELINE, run.states.length);
  return (
    <div className="min-w-0 overflow-x-auto">
      <p className="mb-1 font-mono text-xs text-[var(--muted)]">{title}</p>
      <table className="border-collapse font-mono text-xs">
        <tbody>
          {["IF", "ID", "EX", "MEM", "WB"].map((name, row) => (
            <tr key={name} className="border-t border-[var(--line)]">
              <td className="pr-2 text-[var(--muted)]">{name}</td>
              {Array.from({ length: cols }, (_, c) => {
                const st = run.states[c]?.stages[row];
                return (
                  <td key={c} className="px-1.5 py-0.5 text-[var(--fg)]" style={{ opacity: st?.valid ? 1 : 0.3 }}>
                    {st?.valid ? (st.pc & 0xffff).toString(16).padStart(4, "0") : "··"}
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

export function HazardLab({ mod }: Props) {
  const [id, setId] = useState(HAZARD_CASES[0]?.id ?? "");
  const c = HAZARD_CASES.find((x) => x.id === id) ?? HAZARD_CASES[0];
  const outcome = useMemo(() => (mod && c ? runHazardCase(mod, c) : null), [mod, c]);

  if (!c) return null;
  const stats = (r: RunResult) => buildRunModel(r.states, new Uint8Array(4096)).stats(r.states.length - 1);
  const rows = outcome
    ? [
        { name: "5-stage, forwarding on", run: outcome.pipeFwd },
        { name: "5-stage, forwarding off", run: outcome.pipeNoFwd },
        { name: "single-cycle", run: outcome.single },
      ]
    : [];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2" role="group" aria-label="Hazard cases">
        {HAZARD_CASES.map((x) => (
          <button
            key={x.id}
            onClick={() => setId(x.id)}
            aria-pressed={x.id === id}
            className="rounded-full border px-3 py-1 text-sm"
            style={{
              borderColor: x.id === id ? "var(--accent)" : "var(--line)",
              color: x.id === id ? "var(--fg)" : "var(--muted)",
            }}
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
          {!mod && <p className="text-sm text-[var(--muted)]">Loading the core…</p>}
          {outcome && (
            <>
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
                  {rows.map((row) => {
                    const s = stats(row.run);
                    const base = outcome.single.states.length;
                    return (
                      <tr key={row.name} className="border-t border-[var(--line)]">
                        <td className="py-1 text-[var(--fg)]">{row.name}</td>
                        <td className="py-1 text-right text-[var(--fg)]">{row.run.states.length}</td>
                        <td className="py-1 text-right text-[var(--fg)]">{row.name.startsWith("single") ? "—" : s.stalls}</td>
                        <td className="py-1 text-right text-[var(--fg)]">{row.name.startsWith("single") ? "—" : s.flushes}</td>
                        <td className="py-1 text-right text-[var(--fg)]">
                          {row.run.states.length - base >= 0 ? `+${row.run.states.length - base}` : row.run.states.length - base}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <Timeline run={outcome.pipeFwd} title={`first ${TIMELINE} cycles, forwarding on (pc, low 16 bits)`} />
              <Timeline run={outcome.pipeNoFwd} title={`first ${TIMELINE} cycles, forwarding off`} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
