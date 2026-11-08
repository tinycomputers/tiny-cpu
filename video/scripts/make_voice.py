"""Synthesize the TinyCPU narration with Kokoro (local, Apache-2.0) and write per-scene WAVs plus timing.

Reads  video/script/script.json
Writes video/public/audio/vo-<scene>.wav   (mastered, 48 kHz mono)
       video/src/timing.json                (scene VO lengths and per-line caption times)

Run with the TTS venv:  video/.venv-tts/bin/python video/scripts/make_voice.py
"""
from __future__ import annotations

import json
import subprocess
from pathlib import Path

import numpy as np
import soundfile as sf
from kokoro_onnx import Kokoro

ROOT = Path(__file__).resolve().parent.parent
WORK = ROOT / "scripts" / "_work"
OUT = ROOT / "public" / "audio"
WORK.mkdir(parents=True, exist_ok=True)
OUT.mkdir(parents=True, exist_ok=True)

script = json.loads((ROOT / "script" / "script.json").read_text())
kokoro = Kokoro(str(ROOT / "tts-models" / "kokoro-v1.0.onnx"), str(ROOT / "tts-models" / "voices-v1.0.bin"))

# A blend of two male voices is smoother than either alone.
voice = kokoro.get_voice_style("am_michael") * 0.75 + kokoro.get_voice_style("am_adam") * 0.25
SPEED = float(script.get("speed", 1.0))
SR = 24000


def gap_after(text: str) -> float:
    """Breath after a line, set by its punctuation: a question lifts, a sentence settles, a list ticks along."""
    t = text.rstrip()
    if t.endswith("?"):
        return 0.6
    if t.endswith("."):
        return 0.5
    if t.endswith((":", ";")):
        return 0.3
    return 0.36


def trim(x: np.ndarray, thresh: float = 0.01, keep: float = 0.04) -> np.ndarray:
    idx = np.where(np.abs(x) > thresh)[0]
    if len(idx) == 0:
        return x
    a = max(0, idx[0] - int(keep * SR))
    b = min(len(x), idx[-1] + int(keep * SR))
    return x[a:b]


timing: dict[str, dict] = {}
for scene in script["scenes"]:
    parts: list[np.ndarray] = []
    lines_t = []
    t = 0.0
    for i, line in enumerate(scene["lines"]):
        audio, sr = kokoro.create(line["say"], voice=voice, speed=SPEED, lang="en-us")
        assert sr == SR
        audio = trim(audio)
        # fade the very ends so joins never click
        f = int(0.012 * SR)
        audio[:f] *= np.linspace(0, 1, f)
        audio[-f:] *= np.linspace(1, 0, f)
        dur = len(audio) / SR
        lines_t.append({"show": line["show"], "start": round(t, 3), "end": round(t + dur, 3)})
        parts.append(audio)
        t += dur
        if i < len(scene["lines"]) - 1:
            gap = gap_after(line["say"])
            parts.append(np.zeros(int(gap * SR), dtype=np.float32))
            t += gap
    raw = np.concatenate(parts).astype(np.float32)
    raw_path = WORK / f"vo-{scene['id']}.raw.wav"
    sf.write(raw_path, raw, SR)

    # Mastering: remove rumble, tame mud, add presence and air, gentle compression, level to a consistent loudness.
    out_path = OUT / f"vo-{scene['id']}.wav"
    chain = (
        "highpass=f=75,"
        "equalizer=f=220:t=q:w=1.0:g=-1.5,"
        "equalizer=f=3200:t=q:w=1.2:g=2.2,"
        "equalizer=f=9000:t=h:w=0.7:g=1.2,"
        "acompressor=threshold=-18dB:ratio=1.8:attack=12:release=180:makeup=1.5,"
        "alimiter=limit=0.85:level=disabled"
    )
    subprocess.run(
        ["ffmpeg", "-y", "-v", "error", "-i", str(raw_path), "-af", chain, "-ar", "48000", "-ac", "1", str(out_path)],
        check=True,
    )
    timing[scene["id"]] = {"duration": round(t, 3), "lines": lines_t}
    print(f"{scene['id']:9s} {t:6.2f}s  {len(scene['lines'])} lines")

# Scene schedule: lead-in + narration + tail, rounded up to whole beats so every cut lands on the music.
import math

bpm = float(script.get("bpm", 100))
beat = 60.0 / bpm
cursor = 0.0
for scene in script["scenes"]:
    t = timing[scene["id"]]
    raw = scene.get("lead", 0.5) + t["duration"] + scene.get("tail", 0.6)
    dur = math.ceil(raw / beat - 1e-9) * beat
    t.update({"start": round(cursor, 4), "length": round(dur, 4), "lead": scene.get("lead", 0.5)})
    cursor += dur
    print(f"{scene['id']:9s} start {t['start']:6.2f}s length {t['length']:5.2f}s")
total_vo = sum(s["duration"] for s in timing.values())
print(f"narration {total_vo:.1f}s, video {cursor:.1f}s")
(ROOT / "src" / "timing.json").write_text(json.dumps({"bpm": bpm, "beat": beat, "total": round(cursor, 4), "scenes": timing}, indent=2))
