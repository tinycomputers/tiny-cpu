"""Synthesize the music bed and the sound-effect kit. No downloads, fully deterministic.

Reads  video/src/timing.json (for the total length and the scene cuts)
Writes video/public/audio/music.wav     (stereo, 48 kHz)
       video/public/sfx/*.wav           (mono, 48 kHz)

Run with the TTS venv:  video/.venv-tts/bin/python video/scripts/make_music.py
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import soundfile as sf
from scipy import signal

ROOT = Path(__file__).resolve().parent.parent
SR = 48000
rng = np.random.default_rng(42)

timing = json.loads((ROOT / "src" / "timing.json").read_text())
BPM = timing["bpm"]
BEAT = 60.0 / BPM
TOTAL = timing["total"]
N = int((TOTAL + 3.0) * SR)  # tail for the reverb to ring out


def midi(n: float) -> float:
    return 440.0 * 2 ** ((n - 69) / 12)


def lp(x, fc, order=2):
    sos = signal.butter(order, fc, "low", fs=SR, output="sos")
    return signal.sosfilt(sos, x)


def hp(x, fc, order=2):
    sos = signal.butter(order, fc, "high", fs=SR, output="sos")
    return signal.sosfilt(sos, x)


def bp(x, lo, hi, order=2):
    sos = signal.butter(order, [lo, hi], "band", fs=SR, output="sos")
    return signal.sosfilt(sos, x)


def add(buf, x, t0, gain=1.0):
    i = int(t0 * SR)
    if i >= len(buf):
        return
    j = min(len(buf), i + len(x))
    buf[i:j] += x[: j - i] * gain


def env_ar(n, a, r, curve=2.0):
    e = np.ones(n)
    na, nr = max(1, int(a * SR)), max(1, int(r * SR))
    na, nr = min(na, n), min(nr, n)
    e[:na] = np.linspace(0, 1, na) ** curve
    e[n - nr :] *= np.linspace(1, 0, nr) ** curve
    return e


def saw(f, n, phase=0.0):
    t = np.arange(n) / SR
    return 2.0 * ((f * t + phase) % 1.0) - 1.0


def reverb(x, seconds=2.4, damp=5000.0, wet=0.3):
    n = int(seconds * SR)
    t = np.arange(n) / SR
    ir = rng.standard_normal(n) * np.exp(-t * (6.9 / seconds))
    ir = lp(ir, damp, 1)
    ir[: int(0.012 * SR)] *= np.linspace(0, 1, int(0.012 * SR))
    ir /= np.sqrt(np.sum(ir**2)) + 1e-9
    y = signal.fftconvolve(x, ir)[: len(x)]
    return x * (1 - wet) + y * wet


# ------------------------------------------------------------------ music
CHORDS = {  # voicings (midi), root for bass, arp pool
    "Am": ([45, 52, 57, 60, 64], 33, [57, 60, 64, 67, 69, 72]),
    "F": ([41, 48, 53, 57, 60], 29, [53, 57, 60, 65, 69, 72]),
    "C": ([48, 55, 60, 64, 67], 36, [55, 60, 64, 67, 72, 76]),
    "G": ([43, 50, 55, 59, 62], 31, [55, 59, 62, 67, 71, 74]),
}
PROG = ["Am", "F", "C", "G"]
CHORD_BEATS = 8  # two bars per chord
n_chords = int(np.ceil(TOTAL / BEAT / CHORD_BEATS)) + 1


def chord_at(beat_idx: int) -> str:
    return PROG[(beat_idx // CHORD_BEATS) % 4]


# Energy arc by time (seconds): sparse hook, groove from the "write" scene, peak through hazards/views, final lift.
t_write = timing["scenes"]["write"]["start"]
t_pipe = timing["scenes"]["pipeline"]["start"]
t_trust = timing["scenes"]["trust"]["start"]
t_cta = timing["scenes"]["cta"]["start"]
t_end = TOTAL

pad_bus = np.zeros(N)
arp_bus = np.zeros(N)
bass_bus = np.zeros(N)
drum_bus = np.zeros(N)
kick_times = []

# Pad: detuned saws through a slow low-pass, one chord per two bars, overlapping releases.
for c in range(n_chords):
    name = PROG[c % 4]
    t0 = c * CHORD_BEATS * BEAT
    if t0 >= t_end:
        break
    dur = CHORD_BEATS * BEAT + 1.4
    n = int(dur * SR)
    x = np.zeros(n)
    for m in CHORDS[name][0]:
        f = midi(m)
        for det in (-0.07, 0.0, 0.07):
            x += saw(f * 2 ** (det / 12), n, rng.random()) * 0.25
    # warm filter that opens a little over the chord
    cut = np.linspace(700, 1500, n)
    y = np.zeros(n)
    blk = 2048
    z = None
    for i in range(0, n, blk):
        sos = signal.butter(2, float(cut[i]), "low", fs=SR, output="sos")
        if z is None:
            z = np.zeros((sos.shape[0], 2))
        seg, z = signal.sosfilt(sos, x[i : i + blk], zi=z)
        y[i : i + blk] = seg
    y *= env_ar(n, 0.9, 1.4, 1.6)
    add(pad_bus, y, t0, 0.15)

# Arp: plucked eighth notes from the chord pool; denser and brighter as the video builds.
pattern_a = [0, 2, 4, 2, 3, 5, 3, 1]
pattern_b = [0, 3, 5, 3, 2, 4, 5, 4]
step = BEAT / 2
k = 0
t = 0.0
while t < t_end - 0.3:
    bi = int(t / BEAT)
    pool = CHORDS[chord_at(bi)][2]
    if t >= 2.6:  # enters during the hook, quietly
        pat = pattern_a if (bi // CHORD_BEATS) % 2 == 0 else pattern_b
        m = pool[pat[k % len(pat)]]
        n = int(0.5 * SR)
        f = midi(m)
        tt = np.arange(n) / SR
        v = saw(f, n) * 0.6 + np.sin(2 * np.pi * f * 2 * tt) * 0.25
        v = lp(v, 3200 if t < t_write else 5200, 2) * np.exp(-tt * 9.0)
        v *= 1 - np.exp(-tt * 800)
        level = 0.8 if t < t_write else 0.85
        if t >= t_cta:
            level = 1.0
        # skip some off-beat notes in the hook for air
        if t < t_write and k % 2 == 1:
            level *= 0.0
        add(arp_bus, v, t, 0.13 * level)
    k += 1
    t += step

# Echo on the arp (dotted eighth), stereo spread later.
d = int(BEAT * 0.75 * SR)
echo = np.zeros(N)
echo[d:] += arp_bus[:-d] * 0.38
echo[2 * d :] += arp_bus[: -2 * d] * 0.18
arp_bus += echo

# Bass + kick + hats from the groove start.
t = t_write - 4 * BEAT
beat_i = int(np.ceil(t / BEAT))
while beat_i * BEAT < t_end - 0.6:
    tb = beat_i * BEAT
    name = chord_at(beat_i)
    root = CHORDS[name][1]
    n = int(BEAT * 0.95 * SR)
    tt = np.arange(n) / SR
    f = midi(root)
    if tb >= t_write - 4 * BEAT:
        v = (np.sin(2 * np.pi * f * tt) + 0.25 * saw(f, n)) * np.exp(-tt * 2.2) * env_ar(n, 0.004, 0.08)
        add(bass_bus, lp(v, 600, 2), tb, 0.2)
        # off-beat bass pulse for movement in the middle section
        if t_pipe <= tb < t_cta:
            add(bass_bus, lp(v, 500, 2), tb + BEAT / 2, 0.11)
        # kick
        kn = int(0.32 * SR)
        kt = np.arange(kn) / SR
        fr = 48 + 90 * np.exp(-kt * 38)
        kick = np.sin(2 * np.pi * np.cumsum(fr) / SR) * np.exp(-kt * 11)
        kick *= 1 - np.exp(-kt * 1500)
        if not (t_trust - 2 * BEAT <= tb < t_trust):  # small drop before the numbers
            add(drum_bus, kick, tb, 0.36)
            kick_times.append(tb)
        # offbeat hat
        hn = int(0.05 * SR)
        hat = hp(rng.standard_normal(hn), 7500, 2) * np.exp(-np.arange(hn) / SR * 75)
        add(drum_bus, hat, tb + BEAT / 2, 0.075 if tb < t_cta else 0.1)
        # rim on 2 and 4 during the groove
        if beat_i % 2 == 1 and tb >= t_pipe:
            rn = int(0.07 * SR)
            rim = bp(rng.standard_normal(rn), 1500, 5000, 2) * np.exp(-np.arange(rn) / SR * 60)
            add(drum_bus, rim, tb, 0.09)
    beat_i += 1

# Sidechain: duck pad, arp and bass under every kick.
duck = np.ones(N)
for kt_ in kick_times:
    i = int(kt_ * SR)
    L = int(0.28 * SR)
    seg = 1 - 0.38 * np.exp(-np.arange(min(L, N - i)) / SR * 11)
    duck[i : i + len(seg)] = np.minimum(duck[i : i + len(seg)], seg)
pad_bus *= duck
bass_bus *= duck
arp_bus *= np.sqrt(duck)

# Build: a filtered-noise riser into the CTA and a soft one into the pipeline scene.
for t0, ln in ((t_cta - 4.0, 4.0), (t_pipe - 2.0, 2.0)):
    n = int(ln * SR)
    x = rng.standard_normal(n)
    sweep = np.linspace(0, 1, n) ** 2
    y = np.zeros(n)
    blk = 2048
    z = None
    for i in range(0, n, blk):
        fc = 400 + 7000 * sweep[i]
        sos = signal.butter(2, [fc * 0.6, min(fc * 1.4, 18000)], "band", fs=SR, output="sos")
        if z is None:
            z = np.zeros((sos.shape[0], 2))
        seg, z = signal.sosfilt(sos, x[i : i + blk], zi=z)
        y[i : i + blk] = seg
    y *= sweep**1.5
    add(pad_bus, y, t0, 0.07)

# Final lift: root + fifth sub swell into the end chord.
n_end = int((t_end - t_cta + 2.5) * SR)
tt = np.arange(n_end) / SR
swell = (np.sin(2 * np.pi * midi(36) * tt) * 0.5 + np.sin(2 * np.pi * midi(43) * tt) * 0.25)
swell *= env_ar(n_end, 1.2, 2.2, 1.5)
add(bass_bus, swell, t_cta, 0.12)

# Bus mix with reverb and a bit of stereo width.
wet = reverb(pad_bus + arp_bus * 0.8, 2.6, 5200, 0.34)
mono = wet + bass_bus + drum_bus
mono = lp(mono, 15000, 1)
# stereo: Haas-ish widening on the arp/echo and pad
w = int(0.011 * SR)
left = mono.copy()
right = mono.copy()
left[w:] += 0.22 * (pad_bus[:-w] + arp_bus[:-w])
right[:-w] += 0.22 * (pad_bus[w:] + arp_bus[w:])
music = np.stack([left, right], axis=1)

# Fade-out over the last 3 s of the video and a short fade-in.
n_total = int(TOTAL * SR)
fo = int(3.2 * SR)
g = np.ones(len(music))
g[n_total - fo : n_total] = np.linspace(1, 0, fo) ** 1.6
g[n_total:] = 0
g[: int(0.6 * SR)] *= np.linspace(0, 1, int(0.6 * SR)) ** 1.5
music *= g[:, None]
music = music[:n_total]
peak = np.max(np.abs(music)) + 1e-9
music = music / peak * 0.72
sf.write(ROOT / "public" / "audio" / "music.wav", music.astype(np.float32), SR)
print(f"music {len(music) / SR:.1f}s peak {np.max(np.abs(music)):.2f}")


# ------------------------------------------------------------------ SFX
SFX = ROOT / "public" / "sfx"
SFX.mkdir(parents=True, exist_ok=True)


def save(name, x, level=0.8):
    x = x / (np.max(np.abs(x)) + 1e-9) * level
    f = int(0.004 * SR)
    x[:f] *= np.linspace(0, 1, f)
    x[-f:] *= np.linspace(1, 0, f)
    sf.write(SFX / f"{name}.wav", x.astype(np.float32), SR)


def sweep_noise(dur, f0, f1, q=0.5, shape=1.0):
    """Noise whose band glides from f0 to f1. Short-time spectral mask with overlap-add: no filter-state
    glitches at block boundaries, so the sweep is smooth. q is the band width as a fraction of its centre."""
    n = int(dur * SR)
    x = rng.standard_normal(n)
    nfft, hop = 1024, 256
    win = np.hanning(nfft)
    freqs = np.fft.rfftfreq(nfft, 1 / SR)
    out = np.zeros(n + nfft)
    for start in range(0, n, hop):
        p = start / n
        fc = f0 * (f1 / f0) ** (p**shape)
        bw = max(fc * q, 40.0)
        mask = np.exp(-0.5 * ((freqs - fc) / (bw / 2)) ** 2)
        seg = np.zeros(nfft)
        chunk = x[start : start + nfft]
        seg[: len(chunk)] = chunk * win[: len(chunk)]
        out[start : start + nfft] += np.fft.irfft(np.fft.rfft(seg) * mask, nfft) * win
    y = out[:n]
    return y / (np.max(np.abs(y)) + 1e-9)


def sine_sweep(dur, f0, f1, curve=3.0):
    n = int(dur * SR)
    t = np.arange(n) / SR
    fr = f1 + (f0 - f1) * np.exp(-t * curve / dur)
    return np.sin(2 * np.pi * np.cumsum(fr) / SR)


# whoosh (rising) and whoosh down
w = sweep_noise(0.75, 350, 6000, 0.9, 1.4)
save("whoosh", w * np.sin(np.linspace(0, np.pi, len(w))) ** 1.4, 0.7)
w = sweep_noise(0.55, 5000, 400, 0.9, 1.2)
save("whoosh_down", w * np.sin(np.linspace(0, np.pi, len(w))) ** 1.2, 0.6)
# soft swish for tab changes
w = sweep_noise(0.35, 1200, 4200, 0.8, 1.0)
save("swish", w * np.sin(np.linspace(0, np.pi, len(w))) ** 1.6, 0.5)

# UI click: tiny body thump + a bright tick
n = int(0.09 * SR)
t = np.arange(n) / SR
click = np.sin(2 * np.pi * 1400 * t) * np.exp(-t * 120) * 0.6 + hp(rng.standard_normal(n), 3000, 2) * np.exp(-t * 260) * 0.5
click += np.sin(2 * np.pi * 320 * t) * np.exp(-t * 60) * 0.5
save("click", click, 0.75)

# key tap for the typing moment
n = int(0.05 * SR)
t = np.arange(n) / SR
key = np.sin(2 * np.pi * 900 * t) * np.exp(-t * 220) * 0.4 + bp(rng.standard_normal(n), 1200, 6000, 2) * np.exp(-t * 300)
save("key", key, 0.45)

# soft tick for cycle stepping
n = int(0.04 * SR)
t = np.arange(n) / SR
tick = np.sin(2 * np.pi * 2400 * t) * np.exp(-t * 260)
save("tick", tick, 0.35)

# pop: pitch-drop bubble
p = sine_sweep(0.14, 900, 260, 5.0) * np.exp(-np.arange(int(0.14 * SR)) / SR * 22)
save("pop", p, 0.7)

# riser (3 s) and impact
r = sweep_noise(3.0, 300, 9000, 1.2, 2.2) * (np.linspace(0, 1, int(3.0 * SR)) ** 2)
tone = np.sin(2 * np.pi * np.cumsum(np.linspace(180, 1400, int(3.0 * SR))) / SR) * (np.linspace(0, 1, int(3.0 * SR)) ** 2.5) * 0.35
save("riser", r + tone, 0.7)

n = int(1.6 * SR)
t = np.arange(n) / SR
boom = sine_sweep(1.6, 110, 38, 9.0) * np.exp(-t * 3.2)
boom += lp(rng.standard_normal(n), 1800, 2) * np.exp(-t * 12) * 0.5
boom += hp(rng.standard_normal(n), 4000, 2) * np.exp(-t * 30) * 0.2
save("impact", reverb(boom, 1.4, 3000, 0.25), 0.9)

# chime for PASS / success: two bell partials stack
n = int(2.2 * SR)
t = np.arange(n) / SR
bell = np.zeros(n)
for f, a, dcy in ((1046.5, 1.0, 2.6), (1568.0, 0.6, 3.2), (2093.0, 0.35, 4.0), (3136.0, 0.15, 6.0)):
    bell += np.sin(2 * np.pi * f * t) * np.exp(-t * dcy) * a
bell *= 1 - np.exp(-t * 600)
save("chime", reverb(bell, 1.8, 6000, 0.3), 0.6)

# shimmer: upward arpeggio for the CTA
n = int(1.6 * SR)
sh = np.zeros(n)
for i, m in enumerate((72, 76, 79, 84, 88)):
    nn = int(1.2 * SR)
    t = np.arange(nn) / SR
    v = np.sin(2 * np.pi * midi(m) * t) * np.exp(-t * 3.0) * (1 - np.exp(-t * 500))
    add(sh, v, i * 0.075, 0.5)
save("shimmer", reverb(sh, 1.8, 7000, 0.4), 0.55)

print("sfx:", ", ".join(sorted(p.stem for p in SFX.glob("*.wav"))))
