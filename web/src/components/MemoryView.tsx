import { DATA_BASE } from "../lib/run-model";

interface Props {
  bytes: Uint8Array;
  previous: Uint8Array | null;
  length: number;
}

const WIDTH = 16;

/** Hex dump of data memory; bytes that changed since the previous cycle are highlighted. */
export function MemoryView({ bytes, previous, length }: Props) {
  const rows = Math.ceil(Math.max(length, WIDTH) / WIDTH);
  return (
    <div className="max-h-72 overflow-auto font-mono text-xs">
      {Array.from({ length: rows }, (_, r) => {
        const base = r * WIDTH;
        return (
          <div key={r} className="flex gap-3 whitespace-pre">
            <span className="text-[var(--muted)]">{(DATA_BASE + base).toString(16).padStart(8, "0")}</span>
            <span>
              {Array.from({ length: WIDTH }, (_, c) => {
                const i = base + c;
                const v = bytes[i] ?? 0;
                const changed = previous ? previous[i] !== v : false;
                return (
                  <span key={c} style={{ background: changed ? "var(--active)" : undefined, color: v ? "var(--fg)" : "var(--muted)" }}>
                    {v.toString(16).padStart(2, "0")}
                    {c === WIDTH - 1 ? "" : " "}
                  </span>
                );
              })}
            </span>
          </div>
        );
      })}
    </div>
  );
}
