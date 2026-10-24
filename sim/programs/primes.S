// Sieve of Eratosthenes up to 60: prints every prime.
#include "common.h"

#define LIMIT 60

PROGRAM_BEGIN
        la      s0, sieve               // byte array in .bss, zero-initialised by the loop below
        li      s1, LIMIT
        li      t0, 0
1:      bgt     t0, s1, 2f              // clear sieve[0..LIMIT]
        add     t1, s0, t0
        sb      zero, 0(t1)
        addi    t0, t0, 1
        j       1b
2:      li      s2, 2                   // p
3:
        mv      t2, s2                  // t2 = p*p via repeated addition
        li      t3, 0
        mv      t4, s2
4:      beqz    t4, 5f
        add     t3, t3, t2
        addi    t4, t4, -1
        j       4b
5:      bgt     t3, s1, 8f              // p*p > LIMIT: done sieving
        add     t1, s0, s2
        lbu     t5, 0(t1)
        bnez    t5, 7f                  // p already composite
        mv      t0, t3                  // mark p*p, p*p+p, ...
6:      bgt     t0, s1, 7f
        add     t1, s0, t0
        li      t5, 1
        sb      t5, 0(t1)
        add     t0, t0, s2
        j       6b
7:      addi    s2, s2, 1
        j       3b
8:      li      s2, 2                   // print primes
9:      bgt     s2, s1, 11f
        add     t1, s0, s2
        lbu     t5, 0(t1)
        bnez    t5, 10f
        mv      a0, s2
        call    print_uint
        PUTCI(' ')
10:     addi    s2, s2, 1
        j       9b
11:     PUTCI('\n')
        EXIT(1)

PRINT_UINT_ROUTINE

        .bss
sieve:  .space  LIMIT + 1
