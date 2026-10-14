// 診断パネルの幾何特徴（眉頭の間隔・高さ）と描画が、合成 landmark で破綻しないことを確認する
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";

const html = readFileSync(new URL("../app.js", import.meta.url), "utf8");
const slice = (from, to) => { const a = html.indexOf(from), b = html.indexOf(to, a); assert.ok(a > 0 && b > a, from); return html.slice(a, b); };
const geoSrc = slice("// ---------- 診断用の幾何特徴 ----------", "// ---------- 保存 ----------");
const renderSrc = slice("function renderDiag() {", "\nfunction updateAlertUI() {");
const clamp01 = x => Math.max(0, Math.min(1, x));
const els = { diag: { innerHTML: "" } };
let baseline = null;
const t = (k, p) => k + (p ? " " + JSON.stringify(p) : "");
const mod = new Function("els", "clamp01", "getBaseline", "t", geoSrc + renderSrc.replace(/baseline\?\./g, "getBaseline()?.") + "\nreturn { geoFeatures, renderDiag, pushPeak, peakOf, diag, DIAG_BLEND, textureFromPixels };")(els, clamp01, () => baseline, t);

// 478 点の合成顔。使う点だけ意味のある位置に置く
const lm = Array.from({ length: 478 }, (_, i) => ({ x: 0.5 + (i % 7) * 0.001, y: 0.5 + (i % 5) * 0.001, z: 0 }));
const set = (i, x, y) => { lm[i] = { x, y, z: 0 }; };
set(33, 0.30, 0.40); set(263, 0.70, 0.40);   // 目尻
set(133, 0.42, 0.40); set(362, 0.58, 0.40);  // 目頭
set(2, 0.50, 0.56);                          // 鼻の下
const brows = (inset, down) => { set(107, 0.44 + inset, 0.33 + down); set(55, 0.44 + inset, 0.35 + down); set(336, 0.56 - inset, 0.33 + down); set(285, 0.56 - inset, 0.35 + down); };
brows(0, 0);
const neutral = mod.geoFeatures(lm, 1280, 720);
brows(0.02, 0.02);
const frown = mod.geoFeatures(lm, 1280, 720);
for (const g of [neutral, frown]) for (const k of ["gap", "drop"]) assert.ok(Number.isFinite(g[k]) && g[k] > 0, k);
assert.ok(frown.gap < neutral.gap, "眉を寄せると gap が減る");
assert.ok(frown.drop < neutral.drop, "眉を下げると drop が減る");

// 描画: 基準なし → 変化率なし。基準あり → 基準比が出る
mod.diag.scores = { browDownLeft: 0.12, browDownRight: 0.1 }; mod.diag.geo = frown;
for (const n of mod.DIAG_BLEND) mod.pushPeak(n, 0.3, 1000);
mod.pushPeak("geo:gap", frown.gap, 1000); mod.pushPeak("geo:drop", frown.drop, 1000);
mod.renderDiag();
assert.ok(els.diag.innerHTML.includes("browDownLeft") && els.diag.innerHTML.includes("diag.baseHint"), "no-baseline render");
baseline = { geo: neutral };
mod.renderDiag();
assert.ok(/diag\.base \{"pct":"-\d+%"/.test(els.diag.innerHTML), "with-baseline render: " + els.diag.innerHTML.slice(0, 200));
mod.diag.scores = null; mod.renderDiag();
assert.ok(els.diag.innerHTML.includes("diag.waiting"), "no-face render");
console.log("diag tests passed:", { neutral: { gap: +neutral.gap.toFixed(3), drop: +neutral.drop.toFixed(3) }, frown: { gap: +frown.gap.toFixed(3), drop: +frown.drop.toFixed(3) } });

// 画素ベースのしわの手がかり: 平坦な画像では輪郭がほぼ 0、縦線があれば縦線の割合が高く、横線なら低い
{
  const W = 48, H = 48;
  const img = fill => { const d = new Uint8ClampedArray(W * H * 4); for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const v = fill(x, y); const i = (y * W + x) * 4; d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255; } return d; };
  const flat = mod.textureFromPixels(img(() => 128), W, H);
  const vlines = mod.textureFromPixels(img(x => x % 12 === 6 ? 60 : 128), W, H);
  const hlines = mod.textureFromPixels(img((x, y) => y % 12 === 6 ? 60 : 128), W, H);
  assert.ok(Math.abs(flat.luma - 128) < 1 && flat.energy < 1e-6, "flat");
  assert.ok(vlines.energy > 0.5 && vlines.vertical > 0.9, `vlines ${JSON.stringify(vlines)}`);
  assert.ok(hlines.energy > 0.5 && hlines.vertical < 0.1, `hlines ${JSON.stringify(hlines)}`);
  console.log("texture tests passed:", { flat: +flat.energy.toFixed(3), vlines: { energy: +vlines.energy.toFixed(2), vertical: +vlines.vertical.toFixed(2) }, hlines: { energy: +hlines.energy.toFixed(2), vertical: +hlines.vertical.toFixed(2) } });
}
