interface Props {
  index: number;
  last: number;
  playing: boolean;
  speed: number;
  onGoTo: (i: number) => void;
  onStep: (d: number) => void;
  onPlay: (on: boolean) => void;
  onSpeed: (s: number) => void;
  disabled: boolean;
}

const button =
  "rounded-md border border-[var(--line)] px-3 py-1 font-mono text-sm hover:bg-[var(--active)] disabled:opacity-40";

export function Controls({ index, last, playing, speed, onGoTo, onStep, onPlay, onSpeed, disabled }: Props) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button className={button} disabled={disabled || index === 0} onClick={() => onGoTo(0)} aria-label="Go to start">⏮</button>
      <button className={button} disabled={disabled || index === 0} onClick={() => onStep(-1)} aria-label="Step back">◀</button>
      <button className={button} disabled={disabled || index >= last} onClick={() => onPlay(!playing)} aria-label={playing ? "Pause" : "Play"}>
        {playing ? "❚❚" : "▶︎"}
      </button>
      <button className={button} disabled={disabled || index >= last} onClick={() => onStep(1)} aria-label="Step forward">▶</button>
      <button className={button} disabled={disabled || index >= last} onClick={() => onGoTo(last)} aria-label="Go to end">⏭</button>
      <input
        type="range"
        aria-label="Cycle"
        min={0}
        max={Math.max(0, last)}
        value={Math.min(index, last)}
        disabled={disabled}
        onChange={(e) => onGoTo(Number(e.target.value))}
        className="min-w-32 flex-1"
      />
      <label className="flex items-center gap-1 font-mono text-xs text-[var(--muted)]">
        speed
        <select
          aria-label="Playback speed"
          value={speed}
          onChange={(e) => onSpeed(Number(e.target.value))}
          className="rounded border border-[var(--line)] bg-[var(--bg)] px-1 py-0.5 text-[var(--fg)]"
        >
          {[1, 2, 4, 8, 16, 32].map((s) => (
            <option key={s} value={s}>
              {s}/s
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
