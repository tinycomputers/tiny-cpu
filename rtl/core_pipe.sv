// 5-stage pipelined RV32I core: IF -> ID -> EX -> MEM -> WB.
//
// Phase 3 scope: the datapath, branch/jump flush, faults and halt. There is NO forwarding and NO
// load-use stall yet (Phase 4), so correct results require producers to be >= 3 instructions
// ahead of consumers (the register file's write-first bypass covers WB -> ID). The programs in
// sim/golden/hazard_free.py are built that way.
//
// Timing (docs/ARCHITECTURE.md):
//   IF   pc_q addresses IMEM (synchronous read). The instruction word is the BRAM output register
//        and is decoded in ID the next cycle, alongside id_pc.
//   ID   decode, register read (write-first bypass from WB), immediate.
//   EX   ALU, branch decision, jump target. Taken branches/jumps (predict not-taken) flush IF/ID
//        and ID/EX: a 2-cycle penalty. DMEM is ADDRESSED here (synchronous read).
//   MEM  load data is back from DMEM; LSU extracts/extends. Stores, console and TOHOST write here.
//   WB   register write, CSR read, retire (RVFI), halt/fault decision.
//
// Precise faults/halt: a faulting or halting instruction travels to WB like any other. Younger
// instructions are stopped from touching state by gating MEM side effects while an older
// faulting/halting instruction sits in WB, and by freezing the core (`active`) afterwards. Nothing
// younger ever retires. Faulting instructions never retire; the ISS raises on the same ones.
module core_pipe
    import tiny_cpu_pkg::*;
(
    input  logic                  clk,
    input  logic                  rst_n,

    output logic                  imem_re,
    output logic [IMEM_AW-1:0]    imem_raddr,
    input  logic [31:0]           imem_rdata,

    output logic [DMEM_AW-1:0]    dmem_raddr,
    input  logic [31:0]           dmem_rdata,
    output logic [3:0]            dmem_wmask,
    output logic [DMEM_AW-1:0]    dmem_waddr,
    output logic [31:0]           dmem_wdata,

    output logic                  rvfi_valid,
    output logic [31:0]           rvfi_order,
    output logic [31:0]           rvfi_pc,
    output logic [31:0]           rvfi_insn,
    output logic [4:0]            rvfi_rd_addr,
    output logic [31:0]           rvfi_rd_wdata,
    output logic [31:0]           rvfi_pc_wdata,
    output logic [31:0]           rvfi_mem_addr,
    output logic [3:0]            rvfi_mem_rmask,
    output logic [3:0]            rvfi_mem_wmask,
    output logic [31:0]           rvfi_mem_rdata,
    output logic [31:0]           rvfi_mem_wdata,
    output logic                  rvfi_misaligned,
    output logic                  rvfi_halt,
    output logic                  rvfi_cycle_dep,

    output logic                  console_valid,
    output logic [7:0]            console_data,
    output logic                  tohost_valid,
    output logic [31:0]           tohost_data,

    output logic                  halted,
    output logic                  fault,
    output logic [31:0]           dbg_pc,          // architectural pc: next instruction to retire
    output logic [32*32-1:0]      dbg_regs,
    output logic [31:0]           dbg_cycle,
    output logic [31:0]           dbg_instret,

    output logic [4:0]            dbg_stage_valid, // [0]=IF [1]=ID [2]=EX [3]=MEM [4]=WB
    output logic [5*32-1:0]       dbg_stage_pc,
    output logic [5*32-1:0]       dbg_stage_insn,
    output logic                  dbg_flush_ifid,
    output logic                  dbg_flush_idex
);

    // ====================================================================== state
    logic [31:0] pc_q;
    logic        halted_q, fault_q, active;
    logic [31:0] arch_pc_q;

    assign active = !halted_q && !fault_q;

    // IF/ID
    logic        id_valid, id_fetch_fault;
    logic [31:0] id_pc;

    // ID/EX
    logic        ex_valid, ex_illegal, ex_a_pc, ex_b_imm, ex_reg_we, ex_mem_re, ex_mem_we;
    logic        ex_mem_unsigned, ex_is_branch, ex_is_jal, ex_is_jalr, ex_is_halt;
    logic [31:0] ex_pc, ex_insn, ex_rs1_data, ex_rs2_data, ex_imm;
    alu_op_t     ex_alu_op;
    wb_sel_t     ex_wb_sel;
    mem_size_t   ex_mem_size;

    // EX/MEM
    logic        mm_valid, mm_fault, mm_reg_we, mm_mem_re, mm_mem_we, mm_mem_unsigned, mm_is_halt;
    logic [31:0] mm_pc, mm_insn, mm_val, mm_rs2_data, mm_next_pc;
    wb_sel_t     mm_wb_sel;
    mem_size_t   mm_mem_size;

    // MEM/WB
    logic        wb_valid, wb_fault, wb_reg_we, wb_halt, wb_misaligned, wb_cycle_dep;
    logic [31:0] wb_pc, wb_insn, wb_val, wb_next_pc;
    logic [31:0] wb_mem_addr, wb_mem_rdata, wb_mem_wdata;
    logic [3:0]  wb_mem_rmask, wb_mem_wmask;
    wb_sel_t     wb_sel;

    // ====================================================================== IF
    logic        if_fault;

    assign imem_re    = 1'b1;
    assign imem_raddr = pc_q[IMEM_AW+1:2];
    assign if_fault   = |pc_q[31:IMEM_AW+2];    // pc outside IMEM

    // ====================================================================== ID
    logic [31:0] id_insn, id_imm, id_rs1_data, id_rs2_data;
    alu_op_t     id_alu_op;
    imm_sel_t    id_imm_sel;
    wb_sel_t     id_wb_sel;
    mem_size_t   id_mem_size;
    logic        id_a_pc, id_b_imm, id_reg_we, id_mem_re, id_mem_we, id_mem_unsigned;
    logic        id_is_branch, id_is_jal, id_is_jalr, id_is_halt, id_illegal;
    /* verilator lint_off UNUSEDSIGNAL */
    logic        id_uses_rs1, id_uses_rs2;     // consumed by the hazard unit in Phase 4
    /* verilator lint_on UNUSEDSIGNAL */

    assign id_insn = id_fetch_fault ? 32'b0 : imem_rdata;

    decoder u_decoder (
        .insn(id_insn), .alu_op(id_alu_op), .a_pc(id_a_pc), .b_imm(id_b_imm), .imm_sel(id_imm_sel),
        .reg_we(id_reg_we), .wb_sel(id_wb_sel), .mem_re(id_mem_re), .mem_we(id_mem_we),
        .mem_size(id_mem_size), .mem_unsigned(id_mem_unsigned), .is_branch(id_is_branch),
        .is_jal(id_is_jal), .is_jalr(id_is_jalr), .uses_rs1(id_uses_rs1), .uses_rs2(id_uses_rs2),
        .is_halt(id_is_halt), .illegal(id_illegal)
    );

    imm_gen u_imm_gen (.insn(id_insn), .sel(id_imm_sel), .imm(id_imm));

    // WB-stage write port (declared with WB below)
    logic        wr_en;
    logic [4:0]  wb_rd;
    logic [31:0] wb_wdata;

    regfile #(.BYPASS(1'b1)) u_regfile (
        .clk(clk), .rst_n(rst_n), .raddr1(id_insn[19:15]), .raddr2(id_insn[24:20]),
        .rdata1(id_rs1_data), .rdata2(id_rs2_data), .we(wr_en), .waddr(wb_rd), .wdata(wb_wdata),
        .dbg_regs(dbg_regs)
    );

    // ====================================================================== EX
    logic [31:0] ex_alu_a, ex_alu_b, ex_alu_y, ex_pc_plus4, ex_pc_target, ex_next_pc, ex_val;
    logic        ex_br_taken, ex_redirect_raw, ex_target_misaligned, ex_redirect, ex_fault;

    assign ex_alu_a = ex_a_pc  ? ex_pc  : ex_rs1_data;
    assign ex_alu_b = ex_b_imm ? ex_imm : ex_rs2_data;

    alu u_alu (.a(ex_alu_a), .b(ex_alu_b), .op(ex_alu_op), .y(ex_alu_y));
    branch_unit u_branch (.a(ex_rs1_data), .b(ex_rs2_data), .funct3(ex_insn[14:12]), .taken(ex_br_taken));

    assign ex_pc_plus4  = ex_pc + 32'd4;
    assign ex_pc_target = ex_pc + ex_imm;
    assign ex_redirect_raw = ex_valid && !ex_illegal &&
                             (ex_is_jal || ex_is_jalr || (ex_is_branch && ex_br_taken));
    always_comb begin
        if (ex_is_jalr)           ex_next_pc = {ex_alu_y[31:1], 1'b0};
        else if (ex_redirect_raw) ex_next_pc = ex_pc_target;
        else                      ex_next_pc = ex_pc_plus4;
    end
    assign ex_target_misaligned = ex_redirect_raw && (|ex_next_pc[1:0]);
    assign ex_redirect = ex_redirect_raw && !ex_target_misaligned;   // taken: flush IF/ID + ID/EX
    assign ex_fault    = ex_illegal || ex_target_misaligned;
    assign ex_val      = (ex_wb_sel == WB_PC4) ? ex_pc_plus4 : ex_alu_y;

    // DMEM is addressed in EX; its output register is the load data in MEM.
    assign dmem_raddr = ex_alu_y[DMEM_AW+1:2];

    // ====================================================================== MEM
    logic [31:0] lsu_word_addr, lsu_wdata, lsu_rdata_lanes, lsu_load_value, mm_word;
    logic [3:0]  lsu_lane_mask;
    logic        lsu_misaligned, hit_dmem, mmio_fault, mmio_console_we, mmio_tohost_we;
    logic [31:0] mmio_rdata, mmio_tohost_data, cycle_lo, instret_lo;
    logic [7:0]  mmio_console_data;
    logic        mm_fault_total, mem_effects_ok, older_stop, mm_mem_op;

    lsu u_lsu (
        .addr(mm_val), .size(mm_mem_size), .is_unsigned(mm_mem_unsigned), .store_data(mm_rs2_data),
        .mem_word(mm_word), .word_addr(lsu_word_addr), .lane_mask(lsu_lane_mask),
        .wdata(lsu_wdata), .rdata_lanes(lsu_rdata_lanes), .load_value(lsu_load_value),
        .misaligned(lsu_misaligned)
    );

    mmio u_mmio (
        .word_addr(lsu_word_addr), .re(mm_valid && !mm_fault && mm_mem_re),
        .we(mm_valid && !mm_fault && mm_mem_we), .wmask(lsu_lane_mask), .wdata(lsu_wdata),
        .cycle(cycle_lo), .hit_dmem(hit_dmem), .mmio_rdata(mmio_rdata),
        .console_we(mmio_console_we), .console_data(mmio_console_data),
        .tohost_we(mmio_tohost_we), .tohost_data(mmio_tohost_data), .fault(mmio_fault)
    );

    assign mm_word        = hit_dmem ? dmem_rdata : mmio_rdata;
    assign mm_mem_op      = mm_mem_re || mm_mem_we;
    assign mm_fault_total = mm_valid && (mm_fault || mmio_fault);

    // An older instruction in WB that faults or halts must stop everything younger from having
    // any effect (the ISS never executes those instructions).
    assign older_stop     = wb_valid && (wb_fault || wb_halt);
    assign mem_effects_ok = mm_valid && !mm_fault_total && active && !older_stop;

    assign dmem_wmask = (mem_effects_ok && mm_mem_we && hit_dmem) ? lsu_lane_mask : 4'b0000;
    assign dmem_waddr = lsu_word_addr[DMEM_AW+1:2];
    assign dmem_wdata = lsu_wdata;

    // ====================================================================== WB
    logic [31:0] csr_rdata;
    logic        retire_now, fault_now, halt_now;

    csr_counters u_csr (
        .clk(clk), .rst_n(rst_n), .retire(retire_now), .csr_addr(wb_insn[31:20]),
        .csr_rdata(csr_rdata), .cycle_lo(cycle_lo), .instret_lo(instret_lo)
    );

    assign retire_now = wb_valid && active && !wb_fault;
    assign fault_now  = wb_valid && active && wb_fault;
    assign halt_now   = retire_now && wb_halt;
    assign wb_rd      = wb_insn[11:7];
    assign wb_wdata   = (wb_sel == WB_CSR) ? csr_rdata : wb_val;
    assign wr_en      = retire_now && wb_reg_we && (wb_rd != 5'd0);

    // ====================================================================== pipeline registers
    always_ff @(posedge clk or negedge rst_n) begin
        if (!rst_n) begin
            pc_q <= IMEM_BASE;
            id_valid <= 1'b0;  id_pc <= 32'b0;  id_fetch_fault <= 1'b0;

            ex_valid <= 1'b0;  ex_illegal <= 1'b0;  ex_pc <= 32'b0;  ex_insn <= 32'b0;
            ex_rs1_data <= 32'b0;  ex_rs2_data <= 32'b0;  ex_imm <= 32'b0;
            ex_alu_op <= ALU_ADD;  ex_a_pc <= 1'b0;  ex_b_imm <= 1'b0;  ex_reg_we <= 1'b0;
            ex_wb_sel <= WB_ALU;  ex_mem_re <= 1'b0;  ex_mem_we <= 1'b0;  ex_mem_size <= SZ_WORD;
            ex_mem_unsigned <= 1'b0;  ex_is_branch <= 1'b0;  ex_is_jal <= 1'b0;
            ex_is_jalr <= 1'b0;  ex_is_halt <= 1'b0;

            mm_valid <= 1'b0;  mm_fault <= 1'b0;  mm_reg_we <= 1'b0;  mm_mem_re <= 1'b0;
            mm_mem_we <= 1'b0;  mm_mem_unsigned <= 1'b0;  mm_is_halt <= 1'b0;
            mm_pc <= 32'b0;  mm_insn <= 32'b0;  mm_val <= 32'b0;  mm_rs2_data <= 32'b0;
            mm_next_pc <= 32'b0;  mm_wb_sel <= WB_ALU;  mm_mem_size <= SZ_WORD;

            wb_valid <= 1'b0;  wb_fault <= 1'b0;  wb_reg_we <= 1'b0;  wb_halt <= 1'b0;
            wb_misaligned <= 1'b0;  wb_cycle_dep <= 1'b0;  wb_pc <= 32'b0;  wb_insn <= 32'b0;
            wb_val <= 32'b0;  wb_next_pc <= 32'b0;  wb_mem_addr <= 32'b0;  wb_mem_rdata <= 32'b0;
            wb_mem_wdata <= 32'b0;  wb_mem_rmask <= 4'b0;  wb_mem_wmask <= 4'b0;  wb_sel <= WB_ALU;
        end else begin
            // ---- IF: always fetch; a taken redirect from EX replaces the pc and squashes the
            //      instruction being fetched
            pc_q           <= ex_redirect ? ex_next_pc : pc_q + 32'd4;
            id_valid       <= !ex_redirect;
            id_pc          <= pc_q;
            id_fetch_fault <= if_fault;

            // ---- ID -> EX (squashed by a redirect)
            ex_valid        <= id_valid && !ex_redirect;
            ex_illegal      <= id_illegal || id_fetch_fault;
            ex_pc           <= id_pc;
            ex_insn         <= id_insn;
            ex_rs1_data     <= id_rs1_data;
            ex_rs2_data     <= id_rs2_data;
            ex_imm          <= id_imm;
            ex_alu_op       <= id_alu_op;
            ex_a_pc         <= id_a_pc;
            ex_b_imm        <= id_b_imm;
            ex_reg_we       <= id_reg_we;
            ex_wb_sel       <= id_wb_sel;
            ex_mem_re       <= id_mem_re;
            ex_mem_we       <= id_mem_we;
            ex_mem_size     <= id_mem_size;
            ex_mem_unsigned <= id_mem_unsigned;
            ex_is_branch    <= id_is_branch;
            ex_is_jal       <= id_is_jal;
            ex_is_jalr      <= id_is_jalr;
            ex_is_halt      <= id_is_halt;

            // ---- EX -> MEM
            mm_valid        <= ex_valid;
            mm_fault        <= ex_fault;
            mm_pc           <= ex_pc;
            mm_insn         <= ex_insn;
            mm_val          <= ex_val;
            mm_rs2_data     <= ex_rs2_data;
            mm_next_pc      <= ex_next_pc;
            mm_reg_we       <= ex_reg_we;
            mm_wb_sel       <= ex_wb_sel;
            mm_mem_re       <= ex_mem_re;
            mm_mem_we       <= ex_mem_we;
            mm_mem_size     <= ex_mem_size;
            mm_mem_unsigned <= ex_mem_unsigned;
            mm_is_halt      <= ex_is_halt;

            // ---- MEM -> WB
            wb_valid     <= mm_valid;
            wb_fault     <= mm_fault_total;
            wb_halt      <= mm_is_halt || (mem_effects_ok && mmio_tohost_we);
            wb_pc        <= mm_pc;
            wb_insn      <= mm_insn;
            wb_val       <= mm_mem_re ? lsu_load_value : mm_val;
            wb_next_pc   <= mm_next_pc;
            wb_reg_we    <= mm_reg_we;
            wb_sel       <= mm_wb_sel;
            wb_mem_addr  <= mm_mem_op ? lsu_word_addr : 32'b0;
            wb_mem_rmask <= mm_mem_re ? lsu_lane_mask : 4'b0;
            wb_mem_wmask <= mm_mem_we ? lsu_lane_mask : 4'b0;
            wb_mem_rdata <= mm_mem_re ? lsu_rdata_lanes : 32'b0;
            wb_mem_wdata <= mm_mem_we ? lsu_wdata : 32'b0;
            wb_misaligned <= mm_mem_op && lsu_misaligned;
            wb_cycle_dep <= (mm_mem_re && lsu_word_addr == CYCLE_ADDR) ||
                            (mm_wb_sel == WB_CSR && (mm_insn[31:20] == 12'hC00 || mm_insn[31:20] == 12'hC01));
        end
    end

    // ====================================================================== retire / status
    always_ff @(posedge clk or negedge rst_n) begin
        if (!rst_n) begin
            halted_q <= 1'b0;  fault_q <= 1'b0;  arch_pc_q <= IMEM_BASE;
            rvfi_valid <= 1'b0;  rvfi_order <= 32'b0;  rvfi_pc <= 32'b0;  rvfi_insn <= 32'b0;
            rvfi_rd_addr <= 5'b0;  rvfi_rd_wdata <= 32'b0;  rvfi_pc_wdata <= 32'b0;
            rvfi_mem_addr <= 32'b0;  rvfi_mem_rmask <= 4'b0;  rvfi_mem_wmask <= 4'b0;
            rvfi_mem_rdata <= 32'b0;  rvfi_mem_wdata <= 32'b0;  rvfi_misaligned <= 1'b0;
            rvfi_halt <= 1'b0;  rvfi_cycle_dep <= 1'b0;
            console_valid <= 1'b0;  console_data <= 8'b0;  tohost_valid <= 1'b0;  tohost_data <= 32'b0;
        end else begin
            if (halt_now) halted_q <= 1'b1;
            if (fault_now) fault_q <= 1'b1;
            if (retire_now) arch_pc_q <= wb_next_pc;

            rvfi_valid      <= retire_now;
            rvfi_order      <= instret_lo;
            rvfi_pc         <= wb_pc;
            rvfi_insn       <= wb_insn;
            rvfi_rd_addr    <= (wb_reg_we && wb_rd != 5'd0) ? wb_rd : 5'b0;
            rvfi_rd_wdata   <= (wb_reg_we && wb_rd != 5'd0) ? wb_wdata : 32'b0;
            rvfi_pc_wdata   <= wb_next_pc;
            rvfi_mem_addr   <= wb_mem_addr;
            rvfi_mem_rmask  <= wb_mem_rmask;
            rvfi_mem_wmask  <= wb_mem_wmask;
            rvfi_mem_rdata  <= wb_mem_rdata;
            rvfi_mem_wdata  <= wb_mem_wdata;
            rvfi_misaligned <= wb_misaligned;
            rvfi_halt       <= halt_now;
            rvfi_cycle_dep  <= wb_cycle_dep;

            // MMIO effects happen in MEM (see mem_effects_ok); the byte shows up on the next cycle
            console_valid   <= mem_effects_ok && mmio_console_we;
            console_data    <= mmio_console_data;
            if (mem_effects_ok && mmio_tohost_we) begin
                tohost_valid <= 1'b1;
                tohost_data  <= mmio_tohost_data;
            end
        end
    end

    assign halted      = halted_q;
    assign fault       = fault_q;
    assign dbg_pc      = arch_pc_q;
    assign dbg_cycle   = cycle_lo;
    assign dbg_instret = instret_lo;

    assign dbg_stage_valid = {wb_valid, mm_valid, ex_valid, id_valid, 1'b1};
    // IF has no instruction word yet (synchronous fetch): consumers look it up from the pc.
    assign dbg_stage_pc    = {wb_pc, mm_pc, ex_pc, id_pc, pc_q};
    assign dbg_stage_insn  = {wb_insn, mm_insn, ex_insn, id_insn, 32'b0};
    assign dbg_flush_ifid  = ex_redirect;
    assign dbg_flush_idex  = ex_redirect;

endmodule
