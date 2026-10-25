# Copies 16 words with a byte-by-byte memcpy, checks every word, and prints OK or FAIL.

        .text
_start:
        lui     sp, 0x11
        la      a0, dst
        la      a1, src
        li      a2, 64          # bytes
        call    memcpy
        la      t0, dst
        la      t1, src
        li      t2, 16          # words left to compare
1:      beqz    t2, ok
        lw      t3, 0(t0)
        lw      t4, 0(t1)
        bne     t3, t4, bad
        addi    t0, t0, 4
        addi    t1, t1, 4
        addi    t2, t2, -1
        j       1b
ok:     la      a0, s_ok
        call    print_str
        j       finish
bad:    la      a0, s_bad
        call    print_str
        li      t0, 3           # exit code 3 = mismatch
        lui     t1, 0x20
        sw      t0, 4(t1)
halt:   j       halt

# memcpy: a0 = dst, a1 = src, a2 = byte count.
memcpy: beqz    a2, 2f
1:      lbu     t0, 0(a1)
        sb      t0, 0(a0)
        addi    a0, a0, 1
        addi    a1, a1, 1
        addi    a2, a2, -1
        bnez    a2, 1b
2:      ret

# print_str: a0 = address of a NUL-terminated string.
print_str:
        lui     t1, 0x20
1:      lbu     t0, 0(a0)
        beqz    t0, 2f
        sb      t0, 0(t1)
        addi    a0, a0, 1
        j       1b
2:      ret

# finish: report PASS to the harness and halt.
finish: li      t0, 1
        lui     t1, 0x20
        sw      t0, 4(t1)
halt2:  j       halt2

        .data
        .align  2
src:    .word   0x00000001, 0xdeadbeef, 0x80000000, 0x7fffffff
        .word   0xffffffff, 0x12345678, 0x0badf00d, 0xcafebabe
        .word   0x0f0f0f0f, 0xf0f0f0f0, 0x00ff00ff, 0xff00ff00
        .word   0x13579bdf, 0x2468ace0, 0x55aa55aa, 0xaa55aa55
dst:    .space  64
s_ok:   .asciz  "OK\n"
s_bad:  .asciz  "FAIL\n"
