import { REG_NAMES } from "../lib/isa";
import { hex32 } from "../lib/format";
import type { CycleState } from "../lib/state-schema";

export function RegisterFile({ state, previous }: { state: CycleState | null; previous: CycleState | null }) {
  if (!state) return <p className="text-sm text-[var(--muted)]">No run yet.</p>;
  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 font-mono text-xs sm:grid-cols-4">
      {state.regs.map((v, i) => {
        const changed = previous ? previous.regs[i] !== v : false;
        return (
          <div
            key={i}
            className="flex items-baseline justify-between gap-2 rounded px-1"
            style={{ background: changed ? "var(--active)" : undefined }}
            title={`x${i}`}
          >
            <span className="text-[var(--muted)]">
              x{i} <span className="text-[var(--fg)]">{REG_NAMES[i]}</span>
            </span>
            <span className="text-[var(--fg)]">{hex32(v)}</span>
          </div>
        );
      })}
    </div>
  );
}
