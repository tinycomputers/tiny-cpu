import React from "react";
import { Composition } from "remotion";
import "./index.css";
import { Debug } from "./Debug";
import { TinyCpuDemo } from "./TinyCpuDemo";
import { FPS, HEIGHT, TOTAL_FRAMES, WIDTH } from "./schedule";

export const Root: React.FC = () => (
  <>
    <Composition id="TinyCpuDemo" component={TinyCpuDemo} durationInFrames={TOTAL_FRAMES} fps={FPS} width={WIDTH} height={HEIGHT} />
    <Composition id="Debug" component={Debug} durationInFrames={30} fps={FPS} width={WIDTH} height={HEIGHT} />
  </>
);
