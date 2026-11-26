// PILOT DIAGNOSTIC (not part of the skill pipeline): minimal renderMedia wrapper
// with inputProps + entry override + frame timestamps, to find WHERE the Bridge
// render stalls. Usage:
//   node scripts/diag_render.mjs <Comp> <out.mp4> <a-b> <scale> [inputPropsJSON]
//   env: BRIDGE_ENTRY, REMOTION_GL
import fs from "node:fs";
import path from "node:path";
const TMP = process.env.REMOTION_TMP || (await import("node:os")).tmpdir();
fs.mkdirSync(TMP, { recursive: true });
process.env.TEMP = process.env.TMP = TMP;
const { bundle } = await import("@remotion/bundler");
const { renderMedia, selectComposition } = await import("@remotion/renderer");
const [comp, out, rangeS, scaleS, propsS] = process.argv.slice(2);
const range = rangeS.split("-").map(Number);
const inputProps = propsS ? JSON.parse(propsS) : {};
const chromiumOptions = { gl: process.env.REMOTION_GL || "angle" };
const t0 = Date.now();
const serveUrl = await bundle({ entryPoint: path.resolve(process.env.BRIDGE_ENTRY || "src/index.ts"), publicDir: path.resolve("public") });
console.log(`bundle done ${(Date.now() - t0) / 1000}s`);
const composition = await selectComposition({ serveUrl, id: comp, chromiumOptions, inputProps });
console.log(`comp selected ${(Date.now() - t0) / 1000}s`);
let frames = 0;
await renderMedia({
  composition, serveUrl, codec: "h264", crf: 20, scale: Number(scaleS), outputLocation: out,
  chromiumOptions, timeoutInMilliseconds: 300000, frameRange: range, inputProps,
  onProgress: ({ progress }) => console.log(`progress ${Math.round(progress * 100)}% at ${((Date.now() - t0) / 1000).toFixed(0)}s`),
  onFrameUpdate: (f) => { frames = f; if (f % 5 === 0) console.log(`frames done: ${f} at ${((Date.now() - t0) / 1000).toFixed(0)}s`); },
});
console.log(`DONE frames=${frames} total=${((Date.now() - t0) / 1000).toFixed(1)}s -> ${out}`);
