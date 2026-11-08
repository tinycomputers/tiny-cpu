// Scene schedule and voiceover timing. timing.json is written by scripts/make_voice.py: every scene starts on a
// beat of the 120 BPM music bed and is exactly as long as its narration plus a lead-in and a tail.
import timing from "./timing.json";

export const FPS = 30;
export const WIDTH = 1920;
export const HEIGHT = 1080;

export type SceneId = "hook" | "what" | "write" | "pipeline" | "hazards" | "views" | "trust" | "cta";
export const SCENE_IDS: SceneId[] = ["hook", "what", "write", "pipeline", "hazards", "views", "trust", "cta"];

interface TimedLine {
  show: string;
  start: number;
  end: number;
}
interface TimedScene {
  start: number;
  length: number;
  lead: number;
  duration: number;
  lines: TimedLine[];
}
const T = timing.scenes as Record<SceneId, TimedScene>;

export const BEAT = timing.beat; // seconds
export const TOTAL_SECONDS = timing.total;
export const TOTAL_FRAMES = Math.round(timing.total * FPS);

export const sec = (s: number) => Math.round(s * FPS);

/** Scene start and length in seconds. */
export const sceneStart = (id: SceneId) => T[id].start;
export const sceneLength = (id: SceneId) => T[id].length;
export const sceneEnd = (id: SceneId) => T[id].start + T[id].length;
export const sceneFrom = (id: SceneId) => sec(T[id].start);
export const sceneFrames = (id: SceneId) => sec(T[id].length);

/** Global time (seconds) at which narration line `i` of a scene starts / ends. */
export const lineStart = (id: SceneId, i: number) => T[id].start + T[id].lead + (T[id].lines[i]?.start ?? 0);
export const lineEnd = (id: SceneId, i: number) => T[id].start + T[id].lead + (T[id].lines[i]?.end ?? 0);

/**
 * Global time at which `phrase` begins being spoken in line `i`, estimated from its position in the text
 * (characters are a good proxy for duration in a steady narration).
 */
export function phraseTime(id: SceneId, i: number, phrase: string): number {
  const line = T[id].lines[i];
  if (!line) throw new Error(`no line ${i} in ${id}`);
  const at = line.show.toLowerCase().indexOf(phrase.toLowerCase());
  if (at < 0) throw new Error(`"${phrase}" not in "${line.show}"`);
  const frac = at / line.show.length;
  return lineStart(id, i) + frac * (line.end - line.start);
}

export const voiceStart = (id: SceneId) => T[id].start + T[id].lead;
export const sceneLines = (id: SceneId) => T[id].lines;
export const sceneLead = (id: SceneId) => T[id].lead;
