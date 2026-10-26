# Sieve of Eratosthenes up to 60: prints every prime.
# p*p is computed by repeated addition, because the core has no multiply.

        .text
_start:
        lui     sp, 0x11
        la      s0, sieve       # s0 = sieve base (one byte per number)
        li      s1, 60          # s1 = limit
        li      t0, 0
1:      bgt     t0, s1, 2f      # clear sieve[0..limit]
        add     t1, s0, t0
        sb      zero, 0(t1)
        addi    t0, t0, 1
        j       1b
2:      li      s2, 2           # s2 = p
3:      mv      t4, s2          # t3 = p*p by adding p, p times
        li      t3, 0
4:      beqz    t4, 5f
        add     t3, t3, s2
        addi    t4, t4, -1
        j       4b
5:      bgt     t3, s1, 8f      # p*p past the limit: sieving done
        add     t1, s0, s2
        lbu     t5, 0(t1)
        bnez    t5, 7f          # p is composite: skip it
        mv      t0, t3          # mark p*p, p*p+p, ...
6:      bgt     t0, s1, 7f
        add     t1, s0, t0
        li      t5, 1
        sb      t5, 0(t1)
        add     t0, t0, s2
        j       6b
7:      addi    s2, s2, 1
        j       3b
8:      li      s2, 2           # print the primes
9:      bgt     s2, s1, 11f
        add     t1, s0, s2
        lbu     t5, 0(t1)
        bnez    t5, 10f
        mv      a0, s2
        call    print_uint
        li      a0, 32
        call    putc
10:     addi    s2, s2, 1
        j       9b
11:     li      a0, 10
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
sieve:  .space  61
