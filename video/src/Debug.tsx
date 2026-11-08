import React, { useLayoutEffect, useRef } from "react";
import { AbsoluteFill, delayRender, continueRender, useCurrentFrame } from "remotion";
import { AppPage } from "./ui/AppPage";
import { HERO } from "./ui/runData";

const LEVELS = ["pipeline", "datapath", "hazards", "programs"] as const;

// Plain, camera-less render of the app page: used to measure layout and to check fidelity against the real app.
// Frame 0..3 = the four tabs. The measured rectangles (page coordinates) are POSTed to scripts/collect.mjs.
export const Debug: React.FC = () => {
  const frame = useCurrentFrame();
  const ref = useRef<HTMLDivElement>(null);
  const level = LEVELS[frame % 4] as (typeof LEVELS)[number];
  const [handle] = React.useState(() => delayRender("measure"));
  useLayoutEffect(() => {
    const root = ref.current?.querySelector("[data-page]") as HTMLElement | null;
    if (!root) return;
    const base = root.getBoundingClientRect();
    const out: Record<string, number[]> = { page: [0, 0, base.width, base.height] };
    root.querySelectorAll("[data-focus],[data-btn],[data-pill],[data-hrow],[data-prow],[data-heatmap],[role=tab]").forEach((el) => {
      const r = (el as HTMLElement).getBoundingClientRect();
      const key = (el as HTMLElement).dataset.focus ?? (el as HTMLElement).dataset.btn ?? (el as HTMLElement).dataset.pill ?? (el as HTMLElement).dataset.hrow ?? (el as HTMLElement).dataset.prow ?? ((el as HTMLElement).hasAttribute("data-heatmap") ? "heatmap" : ((el as HTMLElement).id || "el"));
      out[key] = [Math.round(r.left - base.left), Math.round(r.top - base.top), Math.round(r.width), Math.round(r.height)];
    });
    // pipeline stage cards
    root.querySelectorAll("[data-focus=pipeline] > div > div.grid > div").forEach((el, i) => {
      const r = (el as HTMLElement).getBoundingClientRect();
      out[`stage${i}`] = [Math.round(r.left - base.left), Math.round(r.top - base.top), Math.round(r.width), Math.round(r.height)];
    });
    const badges = root.querySelector("[data-focus=pipeline] > div > div.flex.flex-wrap");
    if (badges) {
      const r = (badges as HTMLElement).getBoundingClientRect();
      out.badges = [Math.round(r.left - base.left), Math.round(r.top - base.top), Math.round(r.width), Math.round(r.height)];
    }
    void fetch(`http://localhost:4999/${level}`, { method: "POST", body: JSON.stringify(out) }).catch(() => {});
    setTimeout(() => continueRender(handle), 300);
  }, [level, handle]);
  return (
    <AbsoluteFill style={{ background: "#0d1117", alignItems: "center" }}>
      <div ref={ref}>
        <AppPage
          presetId="sort"
          core="PIPE"
          forwarding
          run={HERO}
          index={11}
          playing={false}
          speed={1}
          level={level}
          hazardId="load-use"
          datapathKey="add"
          programId="sort"
          heatProgress={1}
          stale={false}
          press={null}
          editorScroll={0}
          sourceText={HERO.source}
        />
      </div>
    </AbsoluteFill>
  );
};
