/* Startup for C programs (not used by the riscv-tests or the asm programs in sim/programs). */
    .section .text.init
    .globl _start
_start:
    la      sp, _stack_top
    la      t0, __bss_start
    la      t1, __bss_end
1:  bgeu    t0, t1, 2f
    sw      zero, 0(t0)
    addi    t0, t0, 4
    j       1b
2:  call    main
    slli    a0, a0, 1           /* exit code: 1 = pass (main returned 0), else (code<<1)|1 */
    ori     a0, a0, 1
    lui     t0, 0x20
    sw      a0, 4(t0)           /* TOHOST */
3:  j       3b
