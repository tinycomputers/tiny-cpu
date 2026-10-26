import type { RunStats } from "../lib/run-model";

export function StatsBar({ stats, core, forwarding, status }: { stats: RunStats | null; core: string; forwarding: boolean; status: string }) {
  const cells: [string, string][] = stats
    ? [
        ["cycles", String(stats.cycles)],
        ["instructions", String(stats.instret)],
        ["CPI", stats.instret ? stats.cpi.toFixed(2) : "—"],
        ["stalls", core === "PIPE" ? String(stats.stalls) : "—"],
        ["branch flushes", core === "PIPE" ? String(stats.flushes) : "—"],
        ["forwarded", core === "PIPE" && forwarding ? String(stats.forwards) : "—"],
      ]
    : [];
  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-6">
        {cells.map(([label, value]) => (
          <div key={label} className="rounded-md border border-[var(--line)] p-2">
            <div className="text-xs text-[var(--muted)]">{label}</div>
            <div className="font-mono text-lg text-[var(--fg)]">{value}</div>
          </div>
        ))}
      </div>
      <p className="font-mono text-xs text-[var(--muted)]">{status}</p>
    </div>
  );
}
