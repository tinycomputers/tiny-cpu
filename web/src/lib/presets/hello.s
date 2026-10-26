# Hello, TinyCPU: prints a greeting through the CONSOLE register, then reports PASS.
# CONSOLE is at 0x0002_0000 (a store prints its low byte); TOHOST at 0x0002_0004 (1 = PASS).

        .text
_start:
        la      a0, msg         # a0 = address of the string
        call    print_str
        li      t0, 1
        lui     t1, 0x20        # t1 = 0x0002_0000
        sw      t0, 4(t1)       # TOHOST = 1: halt, PASS
halt:   j       halt

# print_str: a0 = address of a NUL-terminated string.
print_str:
        lui     t1, 0x20        # CONSOLE
1:      lbu     t0, 0(a0)
        beqz    t0, 2f
        sb      t0, 0(t1)
        addi    a0, a0, 1
        j       1b
2:      ret

        .data
msg:    .asciz  "Hello, TinyCPU!\n"
