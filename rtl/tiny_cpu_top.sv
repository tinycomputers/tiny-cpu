// Top level: a core plus its memories, with the program loader and the debug/retire bus.
//
// `CORE` selects the microarchitecture ("SINGLE" now; "PIPE" arrives in Phase 3). The port list is
// identical for both so the testbenches and the WASM harness never change.
//
// Loading a program: hold rst_n low, then for each word pulse load_en with load_sel (0 = IMEM,
// 1 = DMEM), load_addr (word index) and load_data. Release rst_n to run.
module tiny_cpu_top
    import tiny_cpu_pkg::*;
#(
    parameter string CORE = "SINGLE",
    // loader address width: wide enough for the larger memory
    localparam int unsigned LAW = (IMEM_AW > DMEM_AW) ? IMEM_AW : DMEM_AW
) (
    input  logic                clk,
    input  logic                rst_n,

    input  logic                load_en,
    input  logic                load_sel,
    input  logic [LAW-1:0]      load_addr,
    input  logic [31:0]         load_data,

    output logic                rvfi_valid,
    output logic [31:0]         rvfi_order,
    output logic [31:0]         rvfi_pc,
    output logic [31:0]         rvfi_insn,
    output logic [4:0]          rvfi_rd_addr,
    output logic [31:0]         rvfi_rd_wdata,
    output logic [31:0]         rvfi_pc_wdata,
    output logic [31:0]         rvfi_mem_addr,
    output logic [3:0]          rvfi_mem_rmask,
    output logic [3:0]          rvfi_mem_wmask,
    output logic [31:0]         rvfi_mem_rdata,
    output logic [31:0]         rvfi_mem_wdata,
    output logic                rvfi_misaligned,
    output logic                rvfi_halt,
    output logic                rvfi_cycle_dep,

    output logic                console_valid,
    output logic [7:0]          console_data,
    output logic                tohost_valid,
    output logic [31:0]         tohost_data,

    output logic                halted,
    output logic                fault,
    output logic [31:0]         dbg_pc,
    output logic [32*32-1:0]    dbg_regs,
    output logic [31:0]         dbg_cycle,
    output logic [31:0]         dbg_instret
);

    if (CORE == "SINGLE") begin : g_single
        logic [IMEM_AW-1:0] imem_raddr;
        logic [31:0]        imem_rdata;
        logic [DMEM_AW-1:0] dmem_raddr, dmem_waddr;
        logic [31:0]        dmem_rdata, dmem_wdata;
        logic [3:0]         dmem_wmask;

        core_single u_core (
            .clk, .rst_n,
            .imem_raddr, .imem_rdata,
            .dmem_raddr, .dmem_rdata, .dmem_wmask, .dmem_waddr, .dmem_wdata,
            .rvfi_valid, .rvfi_order, .rvfi_pc, .rvfi_insn, .rvfi_rd_addr, .rvfi_rd_wdata,
            .rvfi_pc_wdata, .rvfi_mem_addr, .rvfi_mem_rmask, .rvfi_mem_wmask, .rvfi_mem_rdata,
            .rvfi_mem_wdata, .rvfi_misaligned, .rvfi_halt, .rvfi_cycle_dep,
            .console_valid, .console_data, .tohost_valid, .tohost_data,
            .halted, .fault, .dbg_pc, .dbg_regs, .dbg_cycle, .dbg_instret
        );

        mem_comb #(.WORDS(IMEM_WORDS)) u_imem (
            .clk, .raddr(imem_raddr), .rdata(imem_rdata),
            .wmask(4'b0000), .waddr('0), .wdata(32'b0),     // IMEM is read-only to the core
            .ld_en(load_en && !load_sel), .ld_addr(load_addr[IMEM_AW-1:0]), .ld_data(load_data)
        );

        mem_comb #(.WORDS(DMEM_WORDS)) u_dmem (
            .clk, .raddr(dmem_raddr), .rdata(dmem_rdata),
            .wmask(dmem_wmask), .waddr(dmem_waddr), .wdata(dmem_wdata),
            .ld_en(load_en && load_sel), .ld_addr(load_addr[DMEM_AW-1:0]), .ld_data(load_data)
        );
    end else begin : g_unsupported
        $error("tiny_cpu_top: CORE=\"%s\" is not implemented yet (only \"SINGLE\")", CORE);
    end

endmodule
