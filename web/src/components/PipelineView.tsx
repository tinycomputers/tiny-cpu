import type { AsmResult } from "../lib/assembler";
import { disassemble } from "../lib/disassembler";
import type { CycleState, Stage } from "../lib/state-schema";
import type { RunModel } from "../lib/run-model";
import { hex32 } from "../lib/format";

interface Props {
  state: CycleState | null;
  asm: AsmResult;
  model: RunModel;
  index: number;
  core: "SINGLE" | "PIPE";
}

/** Text for one stage: the instruction in it, or the instruction-memory word at the fetch pc. */
function stageText(stage: Stage, asm: AsmResult): string {
  if (!stage.valid) return "bubble";
  const word = stage.insn !== 0 ? stage.insn : asmWordAt(asm, stage.pc);
  return disassemble(word, stage.pc);
}

function asmWordAt(asm: AsmResult, pc: number): number {
  return asm.imem[pc >>> 2] ?? 0;
}

const FWD = ["none", "EX/MEM", "MEM/WB"] as const;

export function PipelineView({ state, asm, model, index, core }: Props) {
  if (!state) return <p className="text-sm text-[var(--muted)]">Assemble and run a program to see the pipeline.</p>;
  const h = state.hazard;
  const badges: { label: string; tone: "warn" | "info" | "bad" }[] = [];
  if (core === "PIPE") {
    if (h.stall) badges.push({ label: h.loadUse ? "load-use stall" : "stall", tone: "warn" });
    if (h.flushIFID) badges.push({ label: "branch flush (-2)", tone: "bad" });
    if (h.fwdA) badges.push({ label: `A ← ${FWD[h.fwdA]}`, tone: "info" });
    if (h.fwdB) badges.push({ label: `B ← ${FWD[h.fwdB]}`, tone: "info" });
    if (badges.length === 0) badges.push({ label: "no hazard this cycle", tone: "info" });
  } else {
    badges.push({ label: "single-cycle: one instruction per cycle", tone: "info" });
  }

  const cols = Array.from({ length: Math.min(10, index + 1) }, (_, k) => index - (Math.min(10, index + 1) - 1) + k);
  const tone = { warn: "var(--warn)", info: "var(--accent)", bad: "var(--err)" };

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-5">
        {state.stages.map((s) => (
          <div
            key={s.name}
            className="flex min-w-0 flex-col rounded-md border p-2 font-mono text-xs"
            style={{
              borderColor: s.valid ? "var(--accent)" : "var(--line)",
              opacity: s.valid ? 1 : 0.5,
            }}
          >
            <div className="flex items-center justify-between text-[var(--muted)]">
              <span className="font-semibold text-[var(--fg)]">{s.name}</span>
              <span>{s.valid ? hex32(s.pc) : "—"}</span>
            </div>
            <div className="mt-1 truncate text-[var(--fg)]" title={s.valid ? stageText(s, asm) : undefined}>
              {stageText(s, asm)}
            </div>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        {badges.map((b) => (
          <span
            key={b.label}
            className="rounded-full border px-2 py-0.5 font-mono text-xs"
            style={{ borderColor: tone[b.tone], color: tone[b.tone] }}
          >
            {b.label}
          </span>
        ))}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse font-mono text-xs">
          <caption className="mb-1 text-left text-[var(--muted)]">Stage timeline (last {cols.length} cycle{cols.length === 1 ? "" : "s"})</caption>
          <thead>
            <tr className="text-[var(--muted)]">
              <th className="px-2 py-1 text-left font-normal">stage</th>
              {cols.map((c) => (
                <th key={c} className="px-2 py-1 text-left font-normal" style={{ color: c === index ? "var(--accent)" : undefined }}>
                  c{model.states[c]?.cycle ?? c + 1}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(["IF", "ID", "EX", "MEM", "WB"] as const).map((name, row) => (
              <tr key={name} className="border-t border-[var(--line)]">
                <td className="px-2 py-1 text-[var(--muted)]">{name}</td>
                {cols.map((c) => {
                  const st = model.states[c]?.stages[row];
                  const text = st ? stageText(st, asm) : "";
                  return (
                    <td
                      key={c}
                      className="max-w-[9rem] truncate px-2 py-1"
                      style={{
                        color: st?.valid ? "var(--fg)" : "var(--muted)",
                        background: c === index ? "var(--active)" : undefined,
                      }}
                      title={text}
                    >
                      {text}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
