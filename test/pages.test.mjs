// 書き出したトップページ (index.html・en/index.html・sitemap.xml) が元と食い違っていないか確かめる
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { build } from "../scripts/build-pages.mjs";

for (const [file, body] of build()) {
  const cur = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
  assert.equal(cur, body, `${file} is out of date. Run: node scripts/build-pages.mjs`);
}
const en = readFileSync(new URL("../en/index.html", import.meta.url), "utf8");
assert.match(en, /<html lang="en"/);
const visible = en.replace(/<!--[\s\S]*?-->|\/\*[\s\S]*?\*\//g, "").replace(/>日本語</, "");
assert.ok(!/[ぁ-んァ-ン]/.test(visible), "Japanese text left in en/index.html");
assert.match(en, /src="\.\.\/top\.js"/);
assert.match(en, /href="\.\.\/app\.html\?lang=en"/);
console.log("pages ok");
