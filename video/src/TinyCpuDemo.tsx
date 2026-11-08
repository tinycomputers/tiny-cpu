import React from "react";
import { AbsoluteFill, Sequence } from "remotion";
import { AudioMix } from "./AudioMix";
import { Backdrop, Vignette } from "./fx/Layers";
import { Cta } from "./scenes/Cta";
import { Hook } from "./scenes/Hook";
import { Trust } from "./scenes/Trust";
import { What } from "./scenes/What";
import { sceneFrames, sceneFrom } from "./schedule";
import { AppStage } from "./ui/AppStage";

// No on-screen text besides the scenes themselves: the narration is carried by the voice.
// Layers, bottom to top: flat backdrop -> scenes and live app -> light vignette -> audio.
export const TinyCpuDemo: React.FC = () => (
  <AbsoluteFill style={{ background: "#0d1117" }}>
    <Backdrop />

    <Sequence from={sceneFrom("hook")} durationInFrames={sceneFrames("hook")} name="Hook">
      <Hook />
    </Sequence>
    <Sequence from={sceneFrom("what")} durationInFrames={sceneFrames("what")} name="What">
      <What />
    </Sequence>

    {/* the app stage owns the global timeline from "write" to the end of "views" */}
    <AppStage />

    <Sequence from={sceneFrom("trust")} durationInFrames={sceneFrames("trust")} name="Trust">
      <Trust />
    </Sequence>
    <Sequence from={sceneFrom("cta")} durationInFrames={sceneFrames("cta")} name="CTA">
      <Cta />
    </Sequence>

    <Vignette />
    <AudioMix />
  </AbsoluteFill>
);
