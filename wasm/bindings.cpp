// Emscripten embind glue. Build with wasm/build.sh; the JS API is documented in docs/STATE_SCHEMA.md.
#include "harness.cpp"

#include <emscripten/bind.h>

EMSCRIPTEN_BINDINGS(tiny_cpu) {
    emscripten::class_<TinyCpuSim>("TinyCpuSim")
        .constructor<>()
        .function("reset", &TinyCpuSim::reset)
        .function("setForwarding", &TinyCpuSim::setForwarding)
        .function("loadImem", &TinyCpuSim::loadImem)
        .function("loadDmem", &TinyCpuSim::loadDmem)
        .function("start", &TinyCpuSim::start)
        .function("step", &TinyCpuSim::step)
        .function("run", &TinyCpuSim::run)
        .function("runFast", &TinyCpuSim::runFast)
        .function("getRegs", &TinyCpuSim::getRegs)
        .function("readDmem", &TinyCpuSim::readDmem)
        .function("getConsole", &TinyCpuSim::getConsole)
        .function("getCycleCount", &TinyCpuSim::getCycleCount)
        .function("isHalted", &TinyCpuSim::isHalted)
        .function("isFault", &TinyCpuSim::isFault);
}
