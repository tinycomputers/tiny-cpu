import React from "react";
import { theme } from "../theme";

// A tiny SystemVerilog tokenizer: enough for the excerpts on screen, in GitHub-dark colors.
const KEYWORDS = new Set(["module", "endmodule", "input", "output", "logic", "assign", "function", "endfunction", "automatic", "if", "else", "begin", "end", "localparam", "always_comb", "always_ff", "wire", "reg", "parameter"]);

function tokenize(line: string): { t: string; c: string }[] {
  const out: { t: string; c: string }[] = [];
  const re = /(\/\/.*$)|(\d+'[bdh][0-9a-fA-F_]+)|(\b\d+\b)|([A-Za-z_][A-Za-z0-9_]*)|(\s+)|(.)/g;
  let m: RegExpExecArray | null;
  const col = theme.colors.syn;
  while ((m = re.exec(line))) {
    if (m[1]) out.push({ t: m[1], c: col.comment });
    else if (m[2] || m[3]) out.push({ t: (m[2] ?? m[3]) as string, c: col.num });
    else if (m[4]) {
      const w = m[4];
      const next = line.slice(re.lastIndex).trimStart()[0];
      if (KEYWORDS.has(w)) out.push({ t: w, c: col.keyword });
      else if (/^[A-Z][A-Z0-9_]+$/.test(w)) out.push({ t: w, c: col.type });
      else if (next === "(" && w !== "if") out.push({ t: w, c: col.fn });
      else out.push({ t: w, c: col.ident });
    } else out.push({ t: (m[5] ?? m[6]) as string, c: col.ident });
  }
  return out;
}

export const CodeLine: React.FC<{ text: string; style?: React.CSSProperties }> = ({ text, style }) => (
  <div style={{ whiteSpace: "pre", ...style }}>
    {tokenize(text).map((tk, i) => (
      <span key={i} style={{ color: tk.c }}>
        {tk.t}
      </span>
    ))}
  </div>
);
