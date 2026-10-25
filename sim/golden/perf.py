"""Pinned performance baseline: instructions, and cycles per core/mode, for the example programs.

    python -m golden.perf            # print the table
    python -m golden.perf --update   # rewrite sim/perf_baseline.json (do this deliberately)
    python -m golden.perf --check    # exit 1 if the baseline is stale (pytest does this too)

Cycles come from the ISS retire trace and the independent pipeline model. The RTL lockstep suites
assert RTL cycles == model for every one of these programs, so the baseline is pinned against hardware.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

from golden.hazard_free import PROGRAMS
from golden.iss import Iss
from golden.pipemodel import pipe_cycles

ROOT = Path(__file__).resolve().parents[2]
BASELINE = ROOT / "sim" / "perf_baseline.json"
SW_PROGRAMS = ["hello", "fib", "sort", "memcpy", "primes"]


def sources() -> dict[str, tuple[bytes, bytes]]:
    out = {}
    for name in SW_PROGRAMS:
        stem = ROOT / "sw" / "build" / "programs" / name
        if stem.with_suffix(".imem.bin").exists():
            out[name] = (Path(str(stem) + ".imem.bin").read_bytes(), Path(str(stem) + ".dmem.bin").read_bytes())
    for name, build in PROGRAMS.items():
        out[f"hazard_free/{name}"] = build().build()
    return out


def measure(imem: bytes, dmem: bytes) -> dict[str, int]:
    iss = Iss(imem, dmem)
    trace = iss.run(2_000_000)
    n = len(trace)
    return {"instret": n, "single": n, "pipe_fwd": pipe_cycles(trace, True), "pipe_nofwd": pipe_cycles(trace, False)}


def measure_all() -> dict[str, dict[str, int]]:
    return {name: measure(*img) for name, img in sorted(sources().items())}


def table(data) -> str:
    head = f"{'program':<28}{'instrs':>8}{'single':>8}{'pipe+fwd':>10}{'CPI':>7}{'pipe-fwd':>10}{'CPI':>7}"
    rows = [head, "-" * len(head)]
    for name, d in data.items():
        rows.append(f"{name:<28}{d['instret']:>8}{d['single']:>8}{d['pipe_fwd']:>10}"
                    f"{d['pipe_fwd'] / d['instret']:>7.2f}{d['pipe_nofwd']:>10}{d['pipe_nofwd'] / d['instret']:>7.2f}")
    return "\n".join(rows)


def main(argv: list[str]) -> int:
    data = measure_all()
    if "--update" in argv:
        BASELINE.write_text(json.dumps(data, indent=2) + "\n")
        print(f"wrote {BASELINE}")
    elif "--check" in argv:
        pinned = json.loads(BASELINE.read_text())
        missing = [k for k in data if k not in pinned]
        changed = {k: (pinned[k], data[k]) for k in data if k in pinned and pinned[k] != data[k]}
        if missing or changed:
            print(f"perf baseline is stale: missing={missing} changed={changed}", file=sys.stderr)
            return 1
    print(table(data))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
