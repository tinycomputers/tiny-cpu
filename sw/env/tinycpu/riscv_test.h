// Replacement for riscv-tests/env/p/riscv_test.h targeting the TinyCPU memory map.
// No privileged spec: tests start at _start (address 0) and report through TOHOST.
//   PASS -> tohost = 1;   FAIL -> tohost = (TESTNUM << 1) | 1  (TESTNUM > 0, so never 1)
#ifndef _ENV_TINYCPU_H
#define _ENV_TINYCPU_H

#define TOHOST_ADDR_HI 0x20           /* lui t1, 0x20 -> 0x0002_0000; TOHOST is at +4 */

#define RVTEST_RV32U
#define RVTEST_RV64U RVTEST_RV32U     /* the rv32ui wrappers #include rv64ui sources */
#define RVTEST_RV32M
#define TESTNUM gp

#define RVTEST_CODE_BEGIN                                                      \
        .section .text.init;                                                   \
        .align  2;                                                             \
        .globl _start;                                                         \
_start:                                                                        \
        li      TESTNUM, 0;

#define RVTEST_CODE_END                                                        \
        unimp;

#define RVTEST_PASS                                                            \
        li      t0, 1;                                                         \
        lui     t1, TOHOST_ADDR_HI;                                            \
        sw      t0, 4(t1);                                                     \
1:      j       1b;

#define RVTEST_FAIL                                                            \
        slli    t0, TESTNUM, 1;                                                \
        ori     t0, t0, 1;                                                     \
        lui     t1, TOHOST_ADDR_HI;                                            \
        sw      t0, 4(t1);                                                     \
1:      j       1b;

#define EXTRA_DATA

#define RVTEST_DATA_BEGIN                                                      \
        EXTRA_DATA                                                             \
        .data;                                                                 \
        .align  4;                                                             \
        .global begin_signature;                                               \
begin_signature:

#define RVTEST_DATA_END                                                        \
        .align  4;                                                             \
        .global end_signature;                                                 \
end_signature:

#endif
