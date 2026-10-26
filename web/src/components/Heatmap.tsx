import { DATA_BASE } from "../lib/run-model";
import { hex32 } from "../lib/format";

interface Props {
  reads: Uint32Array;
  writes: Uint32Array;
  /** words to show, from the start of data memory */
  words: number;
}

/** Data-memory access counts as a grid: one cell per word, shaded by how often it was loaded or stored. */
export function Heatmap({ reads, writes, words }: Props) {
  let max = 1;
  for (let i = 0; i < words; i++) max = Math.max(max, (reads[i] ?? 0) + (writes[i] ?? 0));
  const cols = 32;
  const rows = Math.ceil(words / cols);
  return (
    <div className="flex flex-col gap-2">
      <div className="grid gap-px" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }} role="img" aria-label="Data memory access heatmap">
        {Array.from({ length: rows * cols }, (_, i) => {
          if (i >= words) return <div key={i} />;
          const r = reads[i] ?? 0;
          const w = writes[i] ?? 0;
          const n = r + w;
          return (
            <div
              key={i}
              title={`${hex32(DATA_BASE + 4 * i)}: ${r} loads, ${w} stores`}
              className="aspect-square rounded-[2px]"
              style={{ background: n ? "var(--accent)" : "var(--panel)", opacity: n ? 0.2 + 0.8 * (n / max) : 0.6, outline: "1px solid var(--line)" }}
            />
          );
        })}
      </div>
      <p className="font-mono text-xs text-[var(--muted)]">
        {words} words from {hex32(DATA_BASE)}; darker = more loads and stores (peak {max}).
      </p>
    </div>
  );
}
