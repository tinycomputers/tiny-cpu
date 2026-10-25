# Fibonacci: computes fib(20) = 6765 and prints it in decimal.
# Decimal conversion uses repeated subtraction, because the core has no multiply or divide.

        .text
_start:
        lui     sp, 0x11        # stack pointer: top of the 4 KiB data memory
        li      s0, 20          # n
        li      a1, 0           # fib(i)
        li      a2, 1           # fib(i+1)
1:      beqz    s0, 2f
        add     a3, a1, a2
        mv      a1, a2
        mv      a2, a3
        addi    s0, s0, -1
        j       1b
2:      mv      a0, a1
        call    print_uint
        li      a0, 10          # newline
        call    putc
        j       finish

# print_uint: a0 = unsigned value, printed in decimal (no newline).
print_uint:
        addi    sp, sp, -16
        sw      ra, 12(sp)
        li      t3, 0           # digits pushed so far
        li      t4, 10
1:      mv      t0, a0          # t0 = value still to divide
        li      t1, 0           # t1 = quotient
2:      bltu    t0, t4, 3f
        addi    t0, t0, -10
        addi    t1, t1, 1
        j       2b
3:      addi    t0, t0, 48      # remainder -> ASCII digit
        add     t2, sp, t3
        sb      t0, 0(t2)
        addi    t3, t3, 1
        mv      a0, t1
        bnez    a0, 1b
4:      addi    t3, t3, -1      # digits come out last-first
        add     t2, sp, t3
        lbu     a0, 0(t2)
        call    putc
        bnez    t3, 4b
        lw      ra, 12(sp)
        addi    sp, sp, 16
        ret

# putc: a0 = byte to print.
putc:   lui     t1, 0x20
        sb      a0, 0(t1)
        ret

# finish: report PASS to the harness and halt.
finish: li      t0, 1
        lui     t1, 0x20
        sw      t0, 4(t1)
halt:   j       halt
