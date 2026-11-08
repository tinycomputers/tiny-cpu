# TinyCPU demo video

A ~70 second product demo, built with [Remotion](https://www.remotion.dev). The interface you see in it is
the real interface: the video imports the web app's own React components (`web/src/components/*`) and feeds
them numbers produced by the real WebAssembly build of the RTL, so nothing on screen is mocked up.

| Layer | Source |
|---|---|
| UI components | `../web/src/components/*` (via the `@web` alias in `remotion.config.ts`) |
| CPU data | `scripts/gen-data.ts` runs the app's assembler and `web/public/tiny_cpu.mjs` and writes `src/data/run-data.json` |
| Colors, fonts | the app's tokens (`web/src/styles/global.css`), Inter + JetBrains Mono, logo bar colors as the 5 pipeline stages |
| Narration | `script/script.json` -> `scripts/make_voice.py` (Kokoro, local, Apache-2.0; male voice blend) |
| Music + SFX | `scripts/make_music.py` (synthesized with numpy, 120 BPM; every scene cut lands on a beat) |
| Timeline | `src/timing.json` (scene lengths come from the narration length, rounded up to whole beats) |

## Rebuild

```bash
cd video
npm install                                   # node_modules may live in /dev/shm on a slow disk
npx tsx scripts/gen-data.ts                   # real CPU run data (needs web/public/tiny_cpu.mjs)

python3 -m venv .venv-tts && .venv-tts/bin/pip install kokoro-onnx soundfile numpy scipy
# model weights (not committed): kokoro-v1.0.onnx + voices-v1.0.bin from
# https://github.com/thewh1teagle/kokoro-onnx/releases/tag/model-files-v1.0  -> tts-models/
.venv-tts/bin/python scripts/make_voice.py    # narration + src/timing.json
.venv-tts/bin/python scripts/make_music.py    # music bed + sound effects

npx remotion studio src/index.ts              # preview
npm run render                                # out/tinycpu-demo.mp4 (1920x1080, 30 fps, h264)
```

Change the script, rerun the two audio commands, and the whole video re-times itself: scenes, captions, camera
moves, cursor clicks and sound effects all derive from `timing.json`.

## Layout measurements

Camera framing uses real DOM positions of the app panels (`src/ui/layout.json`). If the app's layout changes,
regenerate it: start `node scripts/collect.mjs`, then render stills of the `Debug` composition at frames 0 to 3
(`npx remotion still src/index.ts Debug out/d.png --frame N`) and merge `out/layout-*.json`.
