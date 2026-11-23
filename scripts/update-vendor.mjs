// vendor/mediapipe を npm の @mediapipe/tasks-vision の指定版 (省略時は latest) に入れ替え、vendor/NOTICE.md を書き直す。
//   node scripts/update-vendor.mjs [version]
// tgz は registry の integrity (sha512) と一致したときだけ展開する。展開したファイルは実行せず、必要なものをコピーするだけ。
// GitHub Actions では GITHUB_OUTPUT に updated / from / to を書く
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { appendFileSync, copyFileSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const PKG = "@mediapipe/tasks-vision";
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const VENDOR = join(ROOT, "vendor");
const NOTICE = join(VENDOR, "NOTICE.md");
// パッケージ内のパス → vendor/mediapipe 内のパス。SIMD 版の wasm だけ持つ (Chrome 116 以降は SIMD に対応)
const FILES = {
  "vision_bundle.mjs": "vision_bundle.mjs",
  "package.json": "package.json",
  "wasm/vision_wasm_internal.js": "wasm/vision_wasm_internal.js",
  "wasm/vision_wasm_internal.wasm": "wasm/vision_wasm_internal.wasm",
};
// 無い版もあるファイル。無ければ今あるものを残す (LICENSE は 1.2 系から tgz に入っていない。license は Apache-2.0 のまま)
const OPTIONAL = { "LICENSE": "LICENSE" };
// NOTICE.md の SHA-256 一覧に載せるファイル (vendor からの相対パス)
const HASHED = ["mediapipe/vision_bundle.mjs", "mediapipe/wasm/vision_wasm_internal.js", "mediapipe/wasm/vision_wasm_internal.wasm", "models/face_landmarker.task"];

const output = (k, v) => { if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${k}=${v}\n`); };
const sha256 = p => createHash("sha256").update(readFileSync(p)).digest("hex");

const current = JSON.parse(readFileSync(join(VENDOR, "mediapipe/package.json"), "utf8")).version;
const want = process.argv[2] || "latest";
const metaRes = await fetch(`https://registry.npmjs.org/${PKG}/${want}`);
if (!metaRes.ok) throw new Error(`registry: ${PKG}@${want} -> HTTP ${metaRes.status}`);
const meta = await metaRes.json();
const { version } = meta, { tarball, integrity } = meta.dist;

if (version === current) {
  console.log(`up to date: ${PKG} ${current}`);
  output("updated", "false");
  process.exit(0);
}

const tgzRes = await fetch(tarball);
if (!tgzRes.ok) throw new Error(`tarball: HTTP ${tgzRes.status}`);
const tgz = Buffer.from(await tgzRes.arrayBuffer());
const [algo, expected] = integrity.split(/-(.*)/s);
if (algo !== "sha512") throw new Error(`unexpected integrity algorithm: ${algo}`);
const actual = createHash("sha512").update(tgz).digest("base64");
if (actual !== expected) throw new Error(`integrity mismatch for ${tarball}\n expected ${expected}\n actual   ${actual}`);

const work = mkdtempSync(join(tmpdir(), "fw-vendor-"));
try {
  writeFileSync(join(work, "pkg.tgz"), tgz);
  execFileSync("tar", ["-xzf", "pkg.tgz"], { cwd: work });
  const src = join(work, "package");
  const missing = Object.keys(FILES).filter(f => !existsSync(join(src, f)));
  if (missing.length) {
    const wasm = existsSync(join(src, "wasm")) ? readdirSync(join(src, "wasm")).join(", ") : "(no wasm dir)";
    throw new Error(`${version} に必要なファイルが無い: ${missing.join(", ")}\n wasm/: ${wasm}\nファイル構成が変わったので、FILES と app.js の読み込みを見直す`);
  }
  for (const [from, to] of Object.entries(FILES)) copyFileSync(join(src, from), join(VENDOR, "mediapipe", to));
  for (const [from, to] of Object.entries(OPTIONAL)) {
    if (existsSync(join(src, from))) copyFileSync(join(src, from), join(VENDOR, "mediapipe", to));
    else console.warn(`note: ${version} has no ${from}; keeping the current vendor/mediapipe/${to}`);
  }
  const license = JSON.parse(readFileSync(join(src, "package.json"), "utf8")).license;
  if (license !== "Apache-2.0") throw new Error(`license changed to ${license}. 同梱してよいか確認する`);
} finally {
  rmSync(work, { recursive: true, force: true });
}

let notice = readFileSync(NOTICE, "utf8");
const before = notice;
notice = notice
  .replace(/^(## @mediapipe\/tasks-vision )[0-9][^\s（(]*/m, (_, h) => h + version) // 後ろの（Apache-2.0）は残す
  .replace(/^- 取得元: https:\/\/registry\.npmjs\.org\/\S+$/m, `- 取得元: ${tarball}`)
  .replace(/^- npm registry の integrity: `[^`]+`$/m, `- npm registry の integrity: \`${integrity}\``)
  .replace(/(## 各ファイルの SHA-256\n\n```\n)[\s\S]*?(```)/, (_, a, b) => a + HASHED.map(f => `${sha256(join(VENDOR, f))}  ${f}`).join("\n") + "\n" + b);
if (!notice.includes(`tasks-vision ${version}`) || !notice.includes(integrity) || notice === before) throw new Error("NOTICE.md の書き換えに失敗した。書式が変わっていないか確認する");
writeFileSync(NOTICE, notice);

console.log(`updated: ${PKG} ${current} -> ${version}`);
output("updated", "true"); output("from", current); output("to", version);
