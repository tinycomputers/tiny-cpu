import React from "react";
import { Audio, Sequence, staticFile } from "remotion";
import { CUES } from "./Cues";
import { FPS, SCENE_IDS, TOTAL_FRAMES, lineEnd, lineStart, sceneLines, sceneStart, sec, voiceStart } from "./schedule";

// Music ducks under every narrated line (fast attack, slower release) and swells back in the gaps and at the end.
const WINDOWS = SCENE_IDS.flatMap((id) => sceneLines(id).map((_, i) => [lineStart(id, i), lineEnd(id, i)] as const));

const smooth = (x: number) => x * x * (3 - 2 * x);
function musicGain(frame: number): number {
  const t = frame / FPS;
  const open = 0.3; // between lines
  const duck = 0.15; // under the voice
  let g = open;
  for (const [a, b] of WINDOWS) {
    const attack = smooth(Math.min(1, Math.max(0, (t - (a - 0.25)) / 0.25)));
    const release = 1 - smooth(Math.min(1, Math.max(0, (t - b) / 0.5)));
    const w = t < b ? attack : release;
    g = Math.min(g, open - (open - duck) * w);
  }
  // intro breathes a little louder, outro lifts under the final line
  const intro = t < 0.8 ? 0.6 + 0.4 * (t / 0.8) : 1;
  const outro = t > sceneStart("cta") + 8 ? 1.25 : 1;
  return Math.min(1, g * intro * outro);
}

export const AudioMix: React.FC = () => (
  <>
    <Audio src={staticFile("audio/music.wav")} volume={(f) => musicGain(f)} />
    {SCENE_IDS.map((id) => (
      <Sequence key={id} from={sec(voiceStart(id))} durationInFrames={sec(sceneLines(id).at(-1)?.end ?? 0) + 30} layout="none">
        <Audio src={staticFile(`audio/vo-${id}.wav`)} volume={1} />
      </Sequence>
    ))}
    {CUES.map((cue, i) => (
      <Sequence key={i} from={sec(cue.t)} durationInFrames={sec(3)} layout="none">
        <Audio src={staticFile(`sfx/${cue.sfx}.wav`)} volume={cue.vol} />
      </Sequence>
    ))}
  </>
);

export const TOTAL = TOTAL_FRAMES;
