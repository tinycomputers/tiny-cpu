import type { DatapathInfo } from "../lib/datapath";
import { hex32 } from "../lib/format";

interface Props {
  info: DatapathInfo | null;
}

// Block and wire geometry in a fixed 900 x 430 coordinate system; the SVG scales to its container.
const BLOCKS: { id: string; x: number; y: number; w: number; h: number; label: string }[] = [
  { id: "pc", x: 20, y: 170, w: 70, h: 50, label: "PC" },
  { id: "pc4", x: 20, y: 60, w: 70, h: 40, label: "+4" },
  { id: "imem", x: 120, y: 150, w: 90, h: 90, label: "IMEM" },
  { id: "dec", x: 260, y: 40, w: 120, h: 50, label: "decoder" },
  { id: "rf", x: 260, y: 130, w: 120, h: 140, label: "registers" },
  { id: "imm", x: 260, y: 350, w: 120, h: 45, label: "imm gen" },
  { id: "alu", x: 420, y: 150, w: 100, h: 110, label: "ALU" },
  { id: "br", x: 420, y: 40, w: 100, h: 50, label: "branch cmp" },
  { id: "dmem", x: 600, y: 150, w: 100, h: 110, label: "DMEM" },
  { id: "wb", x: 750, y: 170, w: 60, h: 70, label: "write-back" },
];

const WIRES = [
  { id: "pc-imem", d: "M90 195 H120" },
  { id: "pc-pc4", d: "M55 170 V100" },
  { id: "pc4-wb", d: "M90 80 H790 V170" },
  { id: "insn-dec", d: "M165 150 V118 H320 V90" },
  { id: "insn-imm", d: "M165 240 V372 H260" },
  { id: "dec-rf", d: "M320 90 V130" },
  { id: "rs1", d: "M380 170 H420" },
  { id: "rs2", d: "M380 205 H420" },
  { id: "imm-alu", d: "M380 372 H402 V232 H420" },
  { id: "alu-dmem", d: "M520 205 H600" },
  { id: "alu-wb", d: "M520 160 H535 V135 H780 V170" },
  { id: "dmem-wb", d: "M700 205 H750" },
  { id: "wb-rf", d: "M780 240 V410 H320 V270" },
  { id: "br-rs", d: "M380 180 H400 V65 H420" },
  { id: "br-pc", d: "M470 40 V15 H20 V170" },
] as const;

type WireId = (typeof WIRES)[number]["id"];

function activeWires(info: DatapathInfo | null): Set<WireId> {
  const on = new Set<WireId>(["pc-imem", "pc-pc4", "insn-dec"]);
  if (!info) return on;
  if (["I", "S", "B", "U", "J"].includes(info.fmt)) on.add("insn-imm");
  if (info.usesRs1 || info.usesRs2) on.add("dec-rf");
  if (info.usesRs1) on.add("rs1");
  if (info.usesRs2) on.add("rs2");
  if (info.usesImm) on.add("imm-alu");
  if (info.isLoad || info.isStore) on.add("alu-dmem");
  if (info.writesRd && !info.isLoad && !info.isJump) on.add("alu-wb");
  if (info.writesRd && info.isJump) on.add("pc4-wb");
  if (info.isLoad) on.add("dmem-wb");
  if (info.writesRd) on.add("wb-rf");
  if (info.isBranch) {
    on.add("br-rs");
    on.add("br-pc");
  }
  if (info.isJump) on.add("br-pc");
  return on;
}

function labels(info: DatapathInfo | null): Partial<Record<WireId | "insn", { x: number; y: number; text: string }>> {
  if (!info) return {};
  const out: Partial<Record<WireId | "insn", { x: number; y: number; text: string }>> = {
    "insn-dec": { x: 170, y: 112, text: `insn ${hex32(info.insn)}` },
    rs1: { x: 384, y: 160, text: `x${info.rs1} = ${hex32(info.rs1Value)}` },
    rs2: { x: 384, y: 224, text: `x${info.rs2} = ${hex32(info.rs2Value)}` },
    "imm-alu": { x: 404, y: 300, text: `imm ${info.imm}` },
    "alu-dmem": { x: 524, y: 196, text: info.memAddr !== null ? `addr ${hex32(info.memAddr)}` : "" },
    "alu-wb": { x: 560, y: 122, text: info.writesRd && !info.isLoad && !info.isJump ? `result ${hex32(info.writeValue)}` : "" },
    "dmem-wb": { x: 704, y: 196, text: info.memReadValue !== null ? hex32(info.memReadValue) : "" },
    "wb-rf": { x: 520, y: 420, text: info.writesRd ? `write x${info.rd} = ${hex32(info.writeValue)}` : "no register written" },
    "pc4-wb": { x: 560, y: 72, text: info.writesRd && info.isJump ? `link ${hex32(info.pc + 4)}` : "" },
    "br-pc": { x: 130, y: 10, text: `next pc ${hex32(info.nextPc)}${info.isBranch ? (info.taken ? " (taken)" : " (not taken)") : ""}` },
  };
  return out;
}

export function DatapathView({ info }: Props) {
  if (!info) {
    return <p className="text-sm text-[var(--muted)]">Nothing has retired yet. Move the cycle cursor forward.</p>;
  }
  const on = activeWires(info);
  const text = labels(info);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2 font-mono text-sm">
        <span className="font-semibold text-[var(--fg)]">
          {hex32(info.pc)} {info.text}
        </span>
        <span className="text-xs text-[var(--muted)]">
          retire #{info.order}
        </span>
      </div>
      <div className="overflow-x-auto">
        <svg
          viewBox="0 0 900 430"
          role="img"
          aria-label={`Single-cycle datapath for ${info.text}`}
          className="mx-auto block h-auto min-w-[640px] w-full"
          style={{ fontFamily: "var(--font-mono, ui-monospace, monospace)" }}
        >
          <defs>
            <marker id="arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto">
              <path d="M0 0 L8 4 L0 8 z" fill="context-stroke" />
            </marker>
          </defs>
          {WIRES.map((w) => (
            <path
              key={w.id}
              d={w.d}
              fill="none"
              markerEnd="url(#arrow)"
              strokeWidth={on.has(w.id) ? 3 : 1.5}
              stroke={on.has(w.id) ? "var(--accent)" : "var(--line)"}
              strokeDasharray={on.has(w.id) ? undefined : "4 4"}
              opacity={on.has(w.id) ? 1 : 0.6}
            />
          ))}
          {BLOCKS.map((b) => {
            const lit = (b.id === "dec" && on.has("dec-rf")) || (b.id === "alu" && on.has("alu-wb")) || (b.id === "dmem" && (info.isLoad || info.isStore)) || (b.id === "br" && info.isBranch);
            return (
              <g key={b.id}>
                <rect
                  x={b.x}
                  y={b.y}
                  width={b.w}
                  height={b.h}
                  rx={6}
                  fill="var(--panel)"
                  stroke={lit ? "var(--accent)" : "var(--line)"}
                  strokeWidth={lit ? 2.5 : 1.5}
                />
                <text x={b.x + b.w / 2} y={b.y + b.h / 2 + 5} textAnchor="middle" fontSize={14} fill="var(--fg)">
                  {b.label}
                </text>
              </g>
            );
          })}
          {Object.entries(text).map(([key, t]) =>
            t && t.text ? (
              <text key={key} x={t.x} y={t.y} fontSize={12} fill="var(--fg)">
                {t.text}
              </text>
            ) : null,
          )}
        </svg>
      </div>
      <p className="text-xs text-[var(--muted)]">
        Highlighted wires carry values for this instruction; dashed wires are not used by it. Values come from a single-cycle run of the same program, which computes the same architecture.{" "}
        {info.isBranch ? "A branch&apos;s next pc comes from the branch comparison and the target adder." : ""}
      </p>
    </div>
  );
}
