"""GNU reference bytes for the web assembler (web/src/lib/assembler.ts).

    cd sim && python -m golden.gen_asm_fixtures          # rewrite web/src/lib/__tests__/gnu-asm.json
    cd sim && python -m golden.gen_asm_fixtures --check  # exit 1 if stale

Each source is compiled with riscv-none-elf-gcc (-mno-relax, so `call`/`la` keep their auipc+jalr/addi
form) and linked with sw/link.ld, so .text starts at 0 and .data at 0x10000, exactly as the assembler
lays them out. The JSON stores the source and the GNU bytes of .text and of the data span. The TypeScript
test assembles the same source and must reproduce both byte for byte.

Sources: the web presets (web/src/lib/presets/*.s), the macro programs in sim/programs/*.S (preprocessed
with gcc -E first), and a corpus of snippets that touch every mnemonic, pseudo-instruction and directive.
"""

from __future__ import annotations

import json
import re
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "web" / "src" / "lib" / "__tests__" / "gnu-asm.json"
PRESETS = ROOT / "web" / "src" / "lib" / "presets"
PROGRAMS = ROOT / "sim" / "programs"
LINK = ROOT / "sw" / "link.ld"
DATA_BASE = 0x10000
ARCH = ["-march=rv32i_zicsr_zifencei", "-mabi=ilp32", "-mno-relax"]
GCC = "riscv-none-elf-gcc"

SNIPPETS: dict[str, str] = {
    "alu_register": """
_start:
    li a0, 0x7fffffff
    li a1, -3
    add a2, a0, a1
    sub a3, a0, a1
    sll a4, a0, a1
    slt a5, a1, a0
    sltu a6, a1, a0
    xor a7, a0, a1
    srl t0, a1, a0
    sra t1, a1, a0
    or  t2, a0, a1
    and t3, a0, a1
""",
    "alu_immediate": """
_start:
    addi a0, zero, -2048
    addi a1, a0, 2047
    slti a2, a0, -1
    sltiu a3, a0, -1
    xori a4, a0, 0x7f0
    ori  a5, a0, -16
    andi a6, a0, 0x3c
    slli a7, a0, 31
    srli t0, a0, 4
    srai t1, a0, 1
""",
    "loads_stores": """
_start:
    la  a0, buf
    lb  a1, 0(a0)
    lbu a2, 1(a0)
    lh  a3, 2(a0)
    lhu a4, -2(a0)
    lw  a5, 4(a0)
    sb  a1, 8(a0)
    sh  a2, 10(a0)
    sw  a3, 12(a0)
.data
buf: .word 0x80ff7f01, 0xaabbccdd, 0, 0
""",
    "upper_immediates": """
_start:
    lui   a0, 0x12345
    lui   a1, 0xfffff
    lui   a2, 0x80000
    auipc a3, 0
    auipc a4, 0x1
""",
    "branches": """
_start:
    li a0, 5
    li a1, -3
    beq a0, a1, fwd
    bne a0, a1, fwd
    blt a1, a0, fwd
    bge a0, a1, fwd
    bltu a0, a1, fwd
    bgeu a1, a0, fwd
    nop
fwd:
    beq a0, a0, back
back:
    addi a0, a0, -1
    bne a0, zero, back
""",
    "jumps": """
_start:
    jal target
    jal ra, target
    jal zero, target
    la  t0, target
    jalr zero, 0(t0)
    jalr ra, t0, 8
    jalr t1, 4(t0)
    jalr t2
target:
    jalr zero, 0(ra)
""",
    "system_and_counters": """
_start:
    fence
    ecall
    ebreak
    csrrs a0, cycle, zero
    csrrs a1, time, zero
    csrrs a2, instret, zero
    csrrs a3, cycleh, zero
    csrrs a4, timeh, zero
    csrrs a5, instreth, zero
    csrrs a6, 0xc00, zero
    csrr  a7, instret
    rdcycle t0
    rdtime t1
    rdinstret t2
    rdcycleh t3
    rdtimeh t4
    rdinstreth t5
""",
    "pseudo_arithmetic": """
_start:
    nop
    mv a0, a1
    not a2, a3
    neg a4, a5
    seqz a6, a7
    snez t0, t1
    sltz t2, t3
    sgtz t4, t5
""",
    "pseudo_branches": """
_start:
    li a0, 4
    beqz a0, t
    bnez a0, t
    blez a0, t
    bgez a0, t
    bltz a0, t
    bgtz a0, t
    bgt a0, a1, t
    ble a0, a1, t
    bgtu a0, a1, t
    bleu a0, a1, t
t:
    j t
    jr ra
    ret
""",
    "li_values": """
_start:
    li a0, 0
    li a1, 2047
    li a2, -2048
    li a3, 2048
    li a4, -2049
    li a5, 0x12345000
    li a6, 0x12345678
    li a7, 0x7fffffff
    li t0, 0x80000000
    li t1, 0xffffffff
    li t2, 0x800
    li t3, 0xfffff800
""",
    "la_and_calls": """
_start:
    la a0, far
    call near
    tail near
    call far
near:
    ret
.data
far: .word 1
""",
    "data_directives": """
_start:
    nop
.data
    .word 1, -1, 0x7fffffff, 0xffffffff
    .half 0x1234, -2, 65535
    .byte 0, 127, 255, 'A', '\\n'
    .ascii "ab"
    .asciz "cd"
    .string "ef\\x21"
    .space 3
    .space 2, 0xee
    .zero 2
    .align 3
    .word 0xdeadbeef
    .balign 8
    .byte 9
""",
    "rodata_and_sections": """
_start:
    la a0, msg
    lbu a1, 0(a0)
.section .rodata
msg: .asciz "rodata"
.section .text
    nop
""",
    "equ_and_expressions": """
.equ BASE, 0x10000
.equ COUNT, 4 * 3 + 1
_start:
    li a0, BASE + COUNT
    li a1, (1 << 12) - 1
    addi a2, zero, COUNT - 1
    li a3, -(COUNT)
    li a4, 0xf0 | 0x0f
    li a5, 0xff & ~0x0f
    li a6, 7 % 4
    li a7, 'z' - 'a'
.data
    .word BASE + 4, end - start_data
start_data:
    .byte COUNT
end:
""",
    "local_labels": """
_start:
    li a0, 3
1:  addi a0, a0, -1
    bnez a0, 1b
    j 2f
2:  li a1, 1
    beqz a1, 1f
    nop
1:  li a2, 2
""",
    "text_alignment": """
_start:
    nop
    .byte 1
    .align 2
    nop
    .byte 2, 3
    .align 2
    nop
""",
}


def _run(args: list[str]) -> bytes:
    res = subprocess.run(args, capture_output=True)
    if res.returncode != 0:
        raise RuntimeError(f"{' '.join(args)} failed:\n{res.stderr.decode(errors='replace')}")
    return res.stdout


def _sections(elf: Path) -> dict[str, tuple[int, int]]:
    out: dict[str, tuple[int, int]] = {}
    text = _run([f"riscv-none-elf-readelf", "-SW", str(elf)]).decode()
    for line in text.splitlines():
        m = re.search(r"\[\s*\d+\]\s+(\S+)\s+\S+\s+([0-9a-f]+)\s+[0-9a-f]+\s+([0-9a-f]+)", line)
        if m and m.group(1).startswith("."):
            out[m.group(1)] = (int(m.group(2), 16), int(m.group(3), 16))
    return out


def _script(work: Path) -> Path:
    """sw/link.ld minus its ALIGN(4) lines: those pad the output, and as/ld do not pad the program's bytes."""
    lines = [ln for ln in LINK.read_text().splitlines() if "ALIGN(4)" not in ln]
    out = work / "gen.ld"
    out.write_text("\n".join(lines) + "\n")
    return out


def gnu_bytes(name: str, source: str, work: Path) -> dict:
    src = work / f"{re.sub(r'[^A-Za-z0-9_]', '_', name)}.S"
    src.write_text(source)
    elf = src.with_suffix(".elf")
    _run([GCC, *ARCH, "-static", "-nostdlib", "-nostartfiles", "-ffreestanding",
          f"-Wl,-T,{_script(work)}", "-Wl,--no-warn-rwx-segments", str(src), "-o", str(elf)])
    secs = _sections(elf)
    text = _run(["riscv-none-elf-objcopy", "-O", "binary", "-j", ".text", str(elf), "/dev/stdout"]) if ".text" in secs else b""
    data_end = DATA_BASE
    for n, (addr, size) in secs.items():
        if addr >= DATA_BASE and size and n in (".data", ".rodata", ".sdata", ".bss", ".sbss", ".srodata"):
            data_end = max(data_end, addr + size)
    data = bytearray(data_end - DATA_BASE)
    for n, (addr, size) in secs.items():
        if addr < DATA_BASE or not size or n not in (".data", ".rodata", ".sdata", ".srodata"):
            continue
        blob = _run(["riscv-none-elf-objcopy", "-O", "binary", "-j", n, str(elf), "/dev/stdout"])
        data[addr - DATA_BASE : addr - DATA_BASE + len(blob)] = blob
    return {"source": source, "text": text.hex(), "data": bytes(data).hex()}


def preprocessed(path: Path) -> str:
    return _run(["riscv-none-elf-gcc", "-E", "-P", f"-I{PROGRAMS}", str(path)]).decode()


def render() -> str:
    sources: dict[str, str] = {}
    for p in sorted(PRESETS.glob("*.s")):
        sources[f"preset/{p.stem}"] = p.read_text()
    for p in sorted(PROGRAMS.glob("*.S")):
        sources[f"sim_programs/{p.stem}"] = preprocessed(p)
    sources.update({f"snippet/{k}": v for k, v in SNIPPETS.items()})
    with tempfile.TemporaryDirectory(prefix="gnu-asm-") as tmp:
        work = Path(tmp)
        out = {name: gnu_bytes(name, src, work) for name, src in sources.items()}
    return json.dumps(out, indent=1, sort_keys=True) + "\n"


def main(argv: list[str]) -> int:
    text = render()
    if "--check" in argv:
        if not OUT.exists() or OUT.read_text() != text:
            print(f"{OUT} is stale: run `cd sim && python -m golden.gen_asm_fixtures`", file=sys.stderr)
            return 1
        return 0
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(text)
    print(f"wrote {OUT}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
