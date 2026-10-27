"""Writes the TinyCPU logo marks as SVG: the square mark (logo.svg), the favicon, and the social card art.

    python3 web/scripts/make_logo.py

The mark is a chip with pins on four sides. Inside it, three instructions move through five pipeline stages, each one
a step to the right of the one above: the overlap a pipeline gives you. The stage colours are the same in the app.
"""

from pathlib import Path

OUT = Path(__file__).resolve().parents[1] / "public"
BG = "#0d1117"
BODY = "#161b22"
EDGE = "#30363d"
PIN = "#58a6ff"
STAGES = ["#58a6ff", "#7ee787", "#d2a8ff", "#ffa657", "#ff7b72"]  # IF ID EX MEM WB


def pipeline_cells(x0: float, y0: float, span: float, rows: int = 3, cols_total: int = 7) -> str:
    """Staircase of stage cells: row r holds stages 0..4 starting at column r."""
    cell_w = span / cols_total
    cell_h = span / rows
    pad = cell_w * 0.12
    parts = []
    for r in range(rows):
        for s in range(5):
            x = x0 + (r + s) * cell_w + pad
            y = y0 + r * cell_h + cell_h * 0.12
            w = cell_w - 2 * pad
            h = cell_h * 0.76
            parts.append(
                f'<rect x="{x:.1f}" y="{y:.1f}" width="{w:.1f}" height="{h:.1f}" rx="{w * 0.18:.1f}" '
                f'fill="{STAGES[s]}" opacity="{0.95 - 0.12 * r:.2f}"/>'
            )
    return "\n    ".join(parts)


def pins() -> str:
    parts = []
    xs = [158, 212, 256, 300, 354]
    for x in xs:
        parts.append(f'<path d="M{x} 58V112M{x} 400V454"/>')
    for y in xs:
        parts.append(f'<path d="M58 {y}H112M400 {y}H454"/>')
    return f'<g stroke="{PIN}" stroke-width="13" stroke-linecap="round" opacity="0.85">{"".join(parts)}</g>'


def mark(size: int = 512, rounded: bool = True) -> str:
    bg_rx = 96 if rounded else 0
    return f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="{size}" height="{size}">
  <rect width="512" height="512" rx="{bg_rx}" fill="{BG}"/>
  {pins()}
  <rect x="112" y="112" width="288" height="288" rx="26" fill="{BODY}" stroke="{EDGE}" stroke-width="6"/>
  <rect x="136" y="136" width="240" height="240" rx="14" fill="none" stroke="{PIN}" stroke-opacity="0.35" stroke-width="3"/>
  {pipeline_cells(150, 150, 212)}
</svg>
"""


def favicon() -> str:
    # Simpler at 32 px: a chip with one bright diagonal of stages.
    return f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <rect width="32" height="32" rx="6" fill="{BG}"/>
  <rect x="8" y="8" width="16" height="16" rx="2.5" fill="{BODY}" stroke="{PIN}" stroke-width="1.6"/>
  <rect x="10.5" y="10.5" width="4" height="4" rx="0.8" fill="{STAGES[0]}"/>
  <rect x="15" y="12.5" width="4" height="4" rx="0.8" fill="{STAGES[1]}"/>
  <rect x="19.5" y="14.5" width="4" height="4" rx="0.8" fill="{STAGES[2]}"/>
  <rect x="10.5" y="17.5" width="4" height="4" rx="0.8" fill="{STAGES[3]}" opacity="0.7"/>
  <rect x="15" y="19.5" width="4" height="4" rx="0.8" fill="{STAGES[4]}" opacity="0.7"/>
</svg>
"""


def social() -> str:
    """The 1200x630 social card (Open Graph and Twitter), rendered to PNG by render_social.sh."""
    chips = ["RV32I", "SystemVerilog", "WebAssembly", "Verilator"]
    chip_svg = []
    x = 0
    for c in chips:
        w = 28 + len(c) * 10
        chip_svg.append(
            f'<g transform="translate({x:.0f} 0)"><rect width="{w:.0f}" height="46" rx="23" fill="{BODY}" '
            f'stroke="{EDGE}" stroke-width="2"/><text x="{w / 2:.0f}" y="30" text-anchor="middle" '
            f'font-size="18" fill="#c9d1d9" font-family="Inter, DejaVu Sans, sans-serif">{c}</text></g>'
        )
        x += w + 12
    return f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 630" width="1200" height="630">
  <rect width="1200" height="630" fill="{BG}"/>
  <defs>
    <radialGradient id="glow" cx="0.25" cy="0.5" r="0.6">
      <stop offset="0" stop-color="#58a6ff" stop-opacity="0.18"/>
      <stop offset="1" stop-color="#58a6ff" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="1200" height="630" fill="url(#glow)"/>
  <g transform="translate(70 130) scale(0.82)">
    <rect width="512" height="512" rx="96" fill="{BG}" stroke="{EDGE}" stroke-width="4"/>
    {pins()}
    <rect x="112" y="112" width="288" height="288" rx="26" fill="{BODY}" stroke="{EDGE}" stroke-width="6"/>
    <rect x="136" y="136" width="240" height="240" rx="14" fill="none" stroke="{PIN}" stroke-opacity="0.35" stroke-width="3"/>
    {pipeline_cells(150, 150, 212)}
  </g>
  <text x="520" y="250" font-size="104" font-weight="700" fill="#e6edf3" font-family="Inter, DejaVu Sans, sans-serif">TinyCPU</text>
  <text x="524" y="318" font-size="28" fill="#8b949e" font-family="Inter, DejaVu Sans, sans-serif">A real RISC-V CPU, running in your browser</text>
  <g transform="translate(524 370)">{"".join(chip_svg)}</g>
  <text x="524" y="520" font-size="24" fill="#58a6ff" font-family="Inter, DejaVu Sans, sans-serif">tiny-cpu.vercel.app</text>
</svg>
"""


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "logo.svg").write_text(mark(512))
    (OUT / "favicon.svg").write_text(favicon())
    (OUT / "og-image.svg").write_text(social())
    print("wrote logo.svg, favicon.svg and og-image.svg in", OUT)


if __name__ == "__main__":
    main()
