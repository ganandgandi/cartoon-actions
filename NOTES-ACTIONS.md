# NOTES-ACTIONS — design decisions for the Actions parallel render

Prepared 2026-11-26 from the local pilot in `~/workspace/cartoon-pilot/`
(see its NOTES.md for the measurements behind every number below).
Local-only preparation: no GitHub account created, nothing pushed.

## Why this design

The pilot verdict: the kit is sound, the hardware is the blocker. Raw
three.js scene rendering under SwiftShader on 1.5 shared vCPUs costs
~45–80 s/frame at 540x960 and an extrapolated ~180–320 s/frame at
1080x1920. GitHub-hosted `ubuntu-latest` runners are also CPU-only (4 vCPU),
so no single job will be dramatically faster per frame — but Remotion frame
ranges are embarrassingly parallel, and the template's own render script
already accepts `--range a-b`. Split + stitch is the obvious shape.

## Decisions

1. **Dynamic matrix via a setup job.** `workflow_dispatch` inputs are
   strings; a matrix needs a JSON array. The `setup` job emits
   `[0..chunks-1]` with `jq -cn --argjson n "$chunks" '[range(0; $n)]'`
   and the render job consumes it with `fromJSON(...)`. This keeps
   `chunks` a free input instead of a hardcoded matrix size.
2. **Range math in bash, inside each job** (not precomputed in setup):
   `size = ceil(total/chunks) = (total + chunks - 1) / chunks` (integer
   division), `start = idx*size`, `end = min(start+size-1, total-1)`.
   Chunks are contiguous, non-overlapping, and cover `[0, total-1]`
   exactly; the last chunk absorbs the remainder and may be shorter.
   A chunk with `start > end` (only when chunks > total_frames) sets
   `empty=true` and skips render + upload.
   Worked tables are in the validation section below.
3. **`--scale 1` is passed explicitly.** `render_draft.mjs` defaults to
   scale 0.5 (540x960 draft). Forgetting this flag would silently render
   quarter-resolution chunks. (Forced by the script's CLI — see below.)
4. **Audio needs no stitch-side work.** `render_draft.mjs` muxes audio
   itself: for a ranged render it runs
   `ffmpeg -ss <start/fps> -i <mix> ... -shortest`, i.e. each chunk already
   carries its own slice of the mix, encoded AAC 192k, same settings for
   every chunk. Consequences:
   - Every job must generate the *same full-length* mix (here: the 70 s
     silent wav, ≥ 2025 frames / 30 fps = 67.5 s of template).
   - The stitch job can use the concat demuxer with `-c copy`; the
     re-encode fallback exists only as insurance.
   - With a real voice/music mix later, drop the wav generation step and
     supply the real mix file to every job identically.
5. **`REMOTION_GL=swangle` at job env level.** The script's chromium
   options read `process.env.REMOTION_GL` (default `"angle"`). Plain
   `angle` fails on GPU-less machines ("Error creating WebGL context",
   proven on the VM and on Colab). `swangle` = ANGLE on SwiftShader.
6. **`BROWSER_EXE` left unset.** The pilot already patched the script's
   hardcoded Windows Chrome path to `process.env.BROWSER_EXE || undefined`;
   undefined makes Remotion download its own Chrome Headless Shell, which
   is what we want on a fresh runner.
7. **Install: `npm ci` if a lockfile is present, else `npm install`.**
   The pilot generated a `package-lock.json` locally, but the Actions copy
   intentionally contains only the files listed for the copy step, so the
   workflow checks at runtime. If the lockfile is committed later, installs
   become reproducible for free. Either way `--no-audit --no-fund`.
8. **`fail-fast: false`** on the matrix: one slow/dead chunk must not
   cancel the other nine. The stitch job still requires all chunks
   (`needs: render`), so a failed chunk fails the run visibly at stitch
   time via the missing artifact.
9. **Timeouts:** render job 120 min (GitHub-hosted max is 360). At the
   pilot's extrapolated 180–320 s/frame, a 30-frame chunk at 1080x1920 is
   90–160 min on the VM's throttled CPU — runners are unthrottled 4-vCPU,
   so per-frame cost should be several times lower, but the first run is
   exactly where this gets measured. Stitch gets 30 min (mostly artifact
   download + a stream copy).
10. **`public/.gitkeep`.** `public/` is empty in the source (the Kenney
    GLBs were never in the repo) and git drops empty directories;
    `render_draft.mjs` passes `publicDir: path.resolve("public")` to the
    bundler, so the directory must exist after checkout.
11. **Artifact retention 1 day** for both chunks and final: these are
    intermediate/debugging outputs, and 1080x1920 h264 chunks are not
    small (see risks).

## What render_draft.mjs forced on the design

- Default scale 0.5 → explicit `--scale 1` (decision 3).
- Per-chunk audio muxing with `-ss start/fps` → identical full-length mix
  in every job; stream-copy stitch is viable (decision 4).
- GL backend via `REMOTION_GL` env, browser via `BROWSER_EXE` env → both
  handled by env, no script edits needed (decisions 5–6).
- The script writes an intermediate `<out>_silent.mp4` next to the output
  before muxing; harmless in the runner workspace, and the upload step
  names the final chunk file explicitly so the intermediate is never
  uploaded.
- `timeoutInMilliseconds: 300000` inside the script is Remotion's
  per-page-eval timeout, not a whole-render budget — no conflict with the
  120 min job timeout.

## Risks / unknowns

- **Per-job overhead:** every chunk job pays checkout + Node setup +
  npm install (pilot: 270 packages, ~1m49s on the VM; runners should be
  faster) + Remotion's Chrome Headless Shell download + webpack bundle
  (~40 s locally) before frame 1. Estimate 3–6 min of overhead per job.
  With 10 chunks that overhead runs in parallel, so it adds ~once to
  wall-clock — but it also means very small chunks waste proportionally
  more. 300 frames / 10 chunks = 30 frames per job is near the floor of
  sensible chunk size.
- **Per-frame cost on runners is an extrapolation, not a measurement.**
  The VM numbers come from a throttled 1.5 shared-vCPU slice. A dedicated
  4-vCPU runner could plausibly be 3–10× faster per frame, which is the
  difference between "300-frame test takes ~15 min/job" and "~2 h/job".
  This is the #1 thing the first run must measure.
- **Artifact size:** 30 frames of 1080x1920 h264 crf 20 ≈ small (tens of
  MB), but the full 2025-frame run produces ~10 chunks of ~200 frames
  each; total artifact traffic could reach hundreds of MB. GitHub
  artifact storage on free plans is capped (500 MB) — retention 1 day
  mitigates, but a full run should be downloaded and cleared promptly.
- **GitHub Actions minutes:** 10 parallel jobs burn wall-clock minutes
  10× (each job's minutes count separately). On a free private repo
  (2,000 min/month), one full-template run at, say, 60 min/job = 600
  minutes. Public repos get free standard-runner minutes. Budget
  accordingly; the 300-frame test first is deliberate.
- **Concurrency limits:** free plans cap concurrent jobs (20 for free
  tier) — 10 chunks fit, but two simultaneous workflow runs would queue.
- **Missing Kenney assets** (26 `.glb`): scene renders via procedural
  fallbacks with fewer props. If the asset kit is obtained later, it goes
  in `public/bridge/kenney/` and no workflow change is needed.
- **Audio sync at chunk seams:** each chunk's audio is cut by the script
  at `start/fps` with `-shortest`; AAC priming can drift a few ms per
  seam. Inaudible with a silent mix; re-check when a real mix is used —
  worst case, stitch falls back to re-encode, or audio gets muxed once
  at stitch time instead (would require rendering chunks silent).

## What to measure on the first run (defaults: 300 frames, 10 chunks)

1. Per-job overhead: time from job start to the first `render %` log line
   (install + Chrome download + bundle).
2. Per-frame cost on a runner: chunk render wall time / 30 frames, and
   the spread across the 10 jobs (slowest job sets the wall-clock).
3. End-to-end wall time vs the single-machine projection for 300 frames
   (VM projection at 1080x1920: 15–27 hours; anything under ~2 h total
   already proves the approach).
4. Stitch integrity: final duration = 10.0 s, no frozen/duplicated frames
   at the 9 seams, audio present throughout.
5. Artifact sizes per chunk and in total.
6. Only then extrapolate to 2025 frames and decide chunk count
   (more chunks = more parallelism but more overhead + minutes).

## Range tables (validation)

total_frames=300, chunks=10 → size=30:
idx 0: 0-29 · 1: 30-59 · 2: 60-89 · 3: 90-119 · 4: 120-149 ·
5: 150-179 · 6: 180-209 · 7: 210-239 · 8: 240-269 · 9: 270-299

total_frames=2025, chunks=10 → size=203:
idx 0: 0-202 · 1: 203-405 · 2: 406-608 · 3: 609-811 · 4: 812-1014 ·
5: 1015-1217 · 6: 1218-1420 · 7: 1421-1623 · 8: 1624-1826 ·
9: 1827-2024 (198 frames — remainder chunk)
