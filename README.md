# cartoon-actions — parallel GitHub Actions render of BridgeShort

The Remotion + three.js `BridgeShort` composition (from the cartoon-3d-short
BRIDGE template, 1080x1920, 30 fps, 2025 frames total) renders far too slowly
on a single CPU-only machine: rendering is software GL (SwiftShader), measured
at ~45–80 s/frame at 540x960 and ~180–320 s/frame at 1080x1920 on a 1.5-vCPU
shared VM — a 60 s short projects to 90–160 hours on one machine.

This repo moves the same render to **GitHub Actions**: the frame range is
split into N chunks, N `ubuntu-latest` runners render one chunk each **in
parallel**, and a final job stitches the chunks back into one mp4. Per-frame
speed does not change (runners have no GPU either) — wall-clock time drops
because the frames are spread across machines.

## How to run

1. Push this repo to GitHub (any account; nothing here is account-specific).
2. Open the **Actions** tab → **render-bridge** → **Run workflow**.
3. Inputs:
   - `total_frames` — frames to render starting at frame 0. Default **300**
     (a 10-second pipeline test: proves install, Chrome download, chunk
     render, and stitch end to end before committing to a long run).
     Use **2025** for the full template.
   - `chunks` — number of parallel jobs. Default **10**.
4. When the run finishes, download the **`bridge-final`** artifact from the
   run summary page. Per-chunk artifacts (`chunk-0` … `chunk-9`) are kept for
   1 day for debugging.

## How the split/stitch works

- A tiny `setup` job turns the `chunks` input into a JSON index array
  (`[0,1,…,N-1]`) that feeds the render matrix (GitHub matrices must come
  from JSON, so the matrix cannot be built from the raw inputs directly).
- Each render job computes its own range in bash:
  `size = ceil(total_frames / chunks)`, `start = idx * size`,
  `end = min(start + size - 1, total_frames - 1)`. A chunk whose start lands
  past the end (possible when chunks > frames) is skipped.
- Each job installs dependencies, generates a 70 s silent stereo wav, and
  renders with the project's own script at full scale:

  ```
  REMOTION_GL=swangle node scripts/render_draft.mjs BridgeShort chunk-<idx>.mp4 silent_mix.wav --scale 1 --range <start>-<end>
  ```

  `render_draft.mjs` itself muxes the matching slice of the mix into each
  chunk (it seeks the mix by `start / fps`), so every chunk mp4 is a complete
  audio+video segment with identical codec settings.
- The `stitch` job downloads all `chunk-*` artifacts, orders them
  numerically, and joins them with the ffmpeg concat demuxer using stream
  copy (`-c copy`). If copy fails it falls back to a re-encode
  (libx264 crf 20 + AAC 192k).

## Notes

- **No GPU anywhere in this pipeline.** GitHub-hosted runners are CPU-only;
  three.js renders through SwiftShader just like on the local VM. The win is
  purely parallelism: 10 chunks ≈ 10× less wall-clock, minus per-job
  overhead (npm install + Remotion's Chrome Headless Shell download, a few
  minutes per job).
- The 26 Kenney `.glb` models in `public/bridge/kenney/` are not part of the
  original template repo (author's local asset kit). The scene renders
  without them via procedural fallbacks, with fewer props.
- Dependency pins are deliberate (three 0.170.0, postprocessing 6.36.6,
  React 19 + @react-three/fiber v9, Remotion 4.x lockstep). Do not "upgrade"
  them casually — see `NOTES-ACTIONS.md` and the upstream lessons.
