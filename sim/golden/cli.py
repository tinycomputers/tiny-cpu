"""Run a built image on the golden ISS.

    python -m golden.cli run ../sw/build/programs/fib            # prints console + summary
    python -m golden.cli run ../sw/build/programs/fib --trace    # + every retired instruction
    python -m golden.cli run <stem> --trace-last 20              # only the last 20 retires

<stem> is the path without `.imem.bin` / `.dmem.bin` (see sw/Makefile). Exit status is 0 on PASS.
"""

from __future__ import annotations

import argparse
import sys

from golden.iss import Iss, IssError


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="golden.cli", description=__doc__.split("\n")[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    run = sub.add_parser("run", help="run an image to halt")
    run.add_argument("stem")
    run.add_argument("--max", type=int, default=5_000_000, help="instruction limit")
    run.add_argument("--trace", action="store_true", help="print every retire record")
    run.add_argument("--trace-last", type=int, metavar="N", help="print the last N retire records")
    args = ap.parse_args(argv)

    iss = Iss.from_build(args.stem)
    trace = []
    try:
        trace = iss.run(args.max)
    except (IssError, TimeoutError) as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 2
    finally:
        if args.trace:
            print(*trace, sep="\n")
        elif args.trace_last:
            print(*trace[-args.trace_last :], sep="\n")

    print(iss.console_text, end="" if iss.console_text.endswith("\n") else "\n")
    status = "PASS" if iss.passed else f"FAIL(tohost={iss.tohost})"
    print(f"[{status}] {iss.instret} instructions, halted by {iss.halt_reason}", file=sys.stderr)
    return 0 if iss.passed else 1


if __name__ == "__main__":
    raise SystemExit(main())
