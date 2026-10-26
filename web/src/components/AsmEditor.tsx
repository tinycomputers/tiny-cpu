import { useRef } from "react";
import type { AsmError } from "../lib/assembler";

interface Props {
  value: string;
  onChange: (v: string) => void;
  errors: AsmError[];
  /** 1-based source line of the instruction executing now, if any */
  activeLine?: number;
}

const LINE_HEIGHT = "1.5rem";

export function AsmEditor({ value, onChange, errors, activeLine }: Props) {
  const gutter = useRef<HTMLDivElement>(null);
  const lines = value.split("\n").length;
  const errorLines = new Map(errors.map((e) => [e.line, e.message]));

  return (
    <div className="relative flex h-[26rem] min-w-0 overflow-hidden rounded-md border border-[var(--line)] bg-[var(--bg)] font-mono text-sm">
      <div
        ref={gutter}
        aria-hidden
        className="w-12 shrink-0 overflow-hidden border-r border-[var(--line)] bg-[var(--panel)] text-right text-[var(--muted)] select-none"
      >
        {Array.from({ length: lines }, (_, i) => {
          const n = i + 1;
          const isErr = errorLines.has(n);
          const isActive = n === activeLine;
          return (
            <div
              key={n}
              title={errorLines.get(n)}
              className="px-2 leading-6"
              style={{
                height: LINE_HEIGHT,
                background: isActive ? "var(--active)" : undefined,
                color: isErr ? "var(--err)" : undefined,
              }}
            >
              {n}
            </div>
          );
        })}
      </div>
      <textarea
        aria-label="Assembly source"
        spellCheck={false}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onScroll={(e) => {
          if (gutter.current) gutter.current.scrollTop = e.currentTarget.scrollTop;
        }}
        wrap="off"
        className="min-w-0 flex-1 resize-none overflow-auto bg-transparent px-3 py-0 leading-6 text-[var(--fg)] outline-none"
      />
    </div>
  );
}
