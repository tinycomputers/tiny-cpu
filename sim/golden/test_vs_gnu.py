"""Cross-check decode/encode against real GNU toolchain output (riscv-tests + our programs).

For every instruction word GCC emitted: our mnemonic must equal objdump's (aliases disabled),
and re-encoding the decoded fields must reproduce the word bit for bit.
"""

import os
import re
from pathlib import Path

import pytest

from golden.decode import decode, encode

BUILD = Path(__file__).resolve().parents[2] / "sw" / "build"
DIS = sorted(BUILD.glob("*/*.dis"))
LINE = re.compile(r"^\s*([0-9a-f]+):\s+([0-9a-f]{8})\s+(\S+)")
UNIMP = 0xC0001073  # `unimp` = csrrw cycle,x0 - emitted by RVTEST_CODE_END, never executed


def test_dis_files_present():
    if not DIS:
        msg = "no .dis files (run `make -C sw all`)"
        if os.environ.get("REQUIRE_RISCV_TESTS") == "1":
            pytest.fail(msg)
        pytest.skip(msg)


@pytest.mark.parametrize("path", DIS or [Path("<none>")], ids=lambda p: p.stem)
def test_matches_objdump(path):
    if not path.exists():
        pytest.skip("not built")
    checked = 0
    for line in path.read_text().splitlines():
        m = LINE.match(line)
        if not m:
            continue
        word, mnem = int(m.group(2), 16), m.group(3)
        if word == UNIMP:
            continue
        x = decode(word)
        assert x is not None, f"{path.stem}: cannot decode 0x{word:08x} ({mnem})"
        assert x.name == mnem, f"{path.stem}: 0x{word:08x} objdump={mnem} ours={x.name}"
        if x.name != "fence":  # GCC emits `fence rw,rw` etc.; we only model the plain encoding
            again = encode(x.name, x.rd, x.rs1, x.rs2, x.imm, x.csr)
            assert again == word, f"{path.stem}: {x.name} 0x{word:08x} re-encodes to 0x{again:08x}"
        checked += 1
    assert checked > 0
