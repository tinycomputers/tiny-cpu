// Sound-effect cues, all derived from the same timeline as the visuals so they cannot drift apart.
// Each cue starts 2-3 frames BEFORE the visual lands (feels in sync; late feels broken).
import { STAGE_T } from "./ui/AppStage";
import { lineStart, phraseTime, sceneStart, sceneEnd } from "./schedule";

export interface Cue {
  t: number; // seconds, global
  sfx: "whoosh" | "whoosh_down" | "swish" | "click" | "key" | "tick" | "pop" | "riser" | "impact" | "chime" | "shimmer";
  vol: number;
}

const EARLY = 0.08;
const c = (t: number, sfx: Cue["sfx"], vol = 0.5): Cue => ({ t: Math.max(0, t - EARLY), sfx, vol });

const S = STAGE_T;

export const CUES: Cue[] = [
  // hook: logo builds, wordmark lands
  c(lineStart("hook", 1) - 0.35, "whoosh", 0.55),
  c(lineStart("hook", 1) + 0.62, "impact", 0.7),
  c(sceneEnd("hook") - 0.2, "swish", 0.35),

  // what: cards pop in on the words, proof badge lands
  c(phraseTime("what", 0, "written in") - 0.35, "pop", 0.45),
  c(phraseTime("what", 0, "compiled") - 0.25, "pop", 0.45),
  c(phraseTime("what", 0, "WebAssembly") - 0.2, "pop", 0.45),
  c(phraseTime("what", 0, "running live") - 0.25, "pop", 0.5),
  c(lineStart("what", 1) + 0.05, "whoosh", 0.4),
  c(lineStart("what", 1) + 1.45, "chime", 0.35),

  // app enters
  c(S.appIn + 0.05, "whoosh", 0.55),
  c(S.openSelect, "click", 0.5),
  c(S.pickSort, "click", 0.5),
  c(S.pickSort + 0.1, "swish", 0.35),
  c(S.assembleClick, "click", 0.6),
  c(S.assembleClick + 0.12, "pop", 0.4),

  // pipeline steps on every beat
  ...Array.from({ length: 4 }, (_, i) => c(S.stepStart + i * 0.5, "tick", 0.5)),
  c(S.playStart, "click", 0.5),
  c(S.speedUp + 1.35, "pop", 0.35),
  c(S.endClick, "click", 0.55),
  c(S.endClick + 0.15, "chime", 0.55),

  // hazards
  c(S.startClick, "click", 0.5),
  c(S.playHaz, "click", 0.5),
  c(S.fwdHold, "pop", 0.45),
  c(S.stallHold, "pop", 0.45),
  c(S.flushHold, "pop", 0.45),
  c(S.uncheck, "click", 0.55),
  c(S.rerun, "click", 0.55),
  c(S.endClick2, "click", 0.55),
  c(S.endClick2 + 0.1, "whoosh_down", 0.3),

  // views
  c(S.tabDatapath, "click", 0.5),
  c(S.tabDatapath + 0.05, "swish", 0.4),
  c(S.datapathSwap, "swish", 0.3),
  c(S.tabPrograms, "click", 0.5),
  c(S.tabPrograms + 0.05, "swish", 0.4),
  c(S.heatStart, "whoosh", 0.35),

  // trust
  c(phraseTime("trust", 0, "Forty") - 0.1, "pop", 0.45),
  c(phraseTime("trust", 0, "Two hundred") - 0.1, "pop", 0.45),
  c(phraseTime("trust", 0, "All matched") - 0.1, "pop", 0.45),
  c(phraseTime("trust", 0, "All matched") + 0.5, "chime", 0.4),
  c(lineStart("trust", 1) - 0.3, "whoosh", 0.55),
  c(lineStart("trust", 1) + 0.1, "impact", 0.45),

  // cta
  c(sceneStart("cta") + 0.05, "whoosh", 0.5),
  c(lineStart("cta", 1) + 1.15, "click", 0.6),
  c(lineStart("cta", 1) + 1.2, "pop", 0.4),
  c(lineStart("cta", 2) - 0.05, "shimmer", 0.5),
];
