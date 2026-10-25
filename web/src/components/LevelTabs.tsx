export type Level = "pipeline" | "datapath" | "hazards" | "programs";

const LEVELS: { id: Level; label: string }[] = [
  { id: "pipeline", label: "L2 Pipeline" },
  { id: "datapath", label: "L1 Datapath" },
  { id: "hazards", label: "L3 Hazard lab" },
  { id: "programs", label: "L4 Programs" },
];

export function LevelTabs({ value, onChange }: { value: Level; onChange: (l: Level) => void }) {
  return (
    <div role="tablist" aria-label="Views" className="flex flex-wrap gap-1 border-b border-[var(--line)]">
      {LEVELS.map((l) => {
        const selected = l.id === value;
        return (
          <button
            key={l.id}
            role="tab"
            aria-selected={selected}
            aria-controls={`panel-${l.id}`}
            id={`tab-${l.id}`}
            onClick={() => onChange(l.id)}
            className="rounded-t-md border border-b-0 px-3 py-1.5 text-sm"
            style={{
              borderColor: selected ? "var(--accent)" : "transparent",
              color: selected ? "var(--fg)" : "var(--muted)",
              background: selected ? "var(--panel)" : "transparent",
            }}
          >
            {l.label}
          </button>
        );
      })}
    </div>
  );
}
