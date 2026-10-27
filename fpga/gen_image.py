"""Turn a program's binary images into $readmemh files for the FPGA memories (one 32-bit word per line).

    python3 fpga/gen_image.py fib          # reads sw/build/programs/fib.{imem,dmem}.bin
    -> fpga/images/fib.imem.hex, fpga/images/fib.dmem.hex

The files are zero-padded to the full memory size, so $readmemh overwrites every word.
"""

import struct
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
IMEM_WORDS = 1024
DMEM_WORDS = 1024


def words(path: Path, count: int) -> list[int]:
    data = path.read_bytes()
    if len(data) > 4 * count:
        raise SystemExit(f"{path}: {len(data)} bytes does not fit {count} words")
    data += b"\0" * (4 * count - len(data))
    return list(struct.unpack(f"<{count}I", data))


def main(name: str) -> None:
    out = ROOT / "fpga" / "images"
    out.mkdir(parents=True, exist_ok=True)
    src = ROOT / "sw" / "build" / "programs"
    for kind, count in (("imem", IMEM_WORDS), ("dmem", DMEM_WORDS)):
        ws = words(src / f"{name}.{kind}.bin", count)
        (out / f"{name}.{kind}.hex").write_text("".join(f"{w:08x}\n" for w in ws))
        print(f"wrote {out / f'{name}.{kind}.hex'} ({count} words)")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "fib")
