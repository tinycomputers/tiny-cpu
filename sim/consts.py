"""Numeric control encodings mirrored from rtl/tiny_cpu_pkg.sv (checked by golden/test_consts.py)."""

ALU = dict(ADD=0, SUB=1, SLL=2, SLT=3, SLTU=4, XOR=5, SRL=6, SRA=7, OR=8, AND=9, COPY_B=10)
IMM = dict(I=0, S=1, B=2, U=3, J=4)
WB = dict(ALU=0, MEM=1, PC4=2, CSR=3)
SZ = dict(BYTE=0, HALF=1, WORD=2)

# Memory map (docs/PLAN.md section 2.1)
IMEM_WORDS = DMEM_WORDS = 1024
DMEM_BASE = 0x0001_0000
CONSOLE_ADDR = 0x0002_0000
TOHOST_ADDR = 0x0002_0004
CYCLE_ADDR = 0x0002_0008
