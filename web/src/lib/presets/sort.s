# Bubble sort of 12 words in data memory, then print them separated by spaces.

        .text
_start:
        lui     sp, 0x11
        la      s0, array       # s0 = base of the array
        li      s1, 12          # s1 = element count
        addi    s2, s1, -1      # s2 = passes left
1:      blez    s2, 5f
        li      t0, 0           # i
        mv      t1, s0          # t1 = &array[i]
2:      bge     t0, s2, 4f
        lw      a1, 0(t1)
        lw      a2, 4(t1)
        ble     a1, a2, 3f      # already in order
        sw      a2, 0(t1)
        sw      a1, 4(t1)
3:      addi    t0, t0, 1
        addi    t1, t1, 4
        j       2b
4:      addi    s2, s2, -1
        j       1b
5:      li      s2, 0           # print loop
6:      bge     s2, s1, 8f
        slli    t0, s2, 2
        add     t0, t0, s0
        lw      a0, 0(t0)
        call    print_uint
        li      a0, 32          # space
        call    putc
        addi    s2, s2, 1
        j       6b
8:      li      a0, 10          # newline
        call    putc
        j       finish

# print_uint: a0 = unsigned value, printed in decimal (no newline).
print_uint:
        addi    sp, sp, -16
        sw      ra, 12(sp)
        li      t3, 0
        li      t4, 10
1:      mv      t0, a0
        li      t1, 0
2:      bltu    t0, t4, 3f
        addi    t0, t0, -10
        addi    t1, t1, 1
        j       2b
3:      addi    t0, t0, 48
        add     t2, sp, t3
        sb      t0, 0(t2)
        addi    t3, t3, 1
        mv      a0, t1
        bnez    a0, 1b
4:      addi    t3, t3, -1
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

        .data
        .align  2
array:  .word   42, 7, 99, 3, 18, 64, 1, 27, 85, 11, 50, 5
