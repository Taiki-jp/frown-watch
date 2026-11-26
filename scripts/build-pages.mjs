// トップページを言語ごとの静的な HTML に書き出す。index.html (日本語) が元で、en/index.html を作る。
// 検索エンジンと SNS のプレビューは JS を待たずに HTML を読むので、言語ごとに URL を分けて中身を最初から入れておく。
//   node scripts/build-pages.mjs          書き出す
//   node scripts/build-pages.mjs --check  書き出した結果と差があれば失敗する (テスト用)
// ビルド工程は持たない方針なので、書き出した HTML もリポジトリに入れる
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { makeT } from "../i18n.js";

export const ORIGIN = "https://taiki-jp.github.io/frown-watch/";
export const PAGES = [
  { lang: "ja", path: "", file: "index.html", locale: "ja_JP" },
  { lang: "en", path: "en/", file: "en/index.html", locale: "en_US" },
];

const root = new URL("../", import.meta.url);
const esc = s => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function head(page, t) {
  const url = ORIGIN + page.path;
  const img = `${ORIGIN}docs/og-${page.lang}.png`;
  const other = PAGES.find(p => p !== page);
  return [
    `<title>${esc(t("meta.title"))}</title>`,
    `<meta name="description" content="${esc(t("meta.desc"))}">`,
    `<link rel="canonical" href="${url}">`,
    ...PAGES.map(p => `<link rel="alternate" hreflang="${p.lang}" href="${ORIGIN + p.path}">`),
    `<link rel="alternate" hreflang="x-default" href="${ORIGIN}en/">`,
    `<meta property="og:type" content="website">`,
    `<meta property="og:site_name" content="Frown Watch">`,
    `<meta property="og:title" content="${esc(t("meta.ogTitle"))}">`,
    `<meta property="og:description" content="${esc(t("meta.desc"))}">`,
    `<meta property="og:url" content="${url}">`,
    `<meta property="og:image" content="${img}">`,
    `<meta property="og:image:width" content="1200">`,
    `<meta property="og:image:height" content="630">`,
    `<meta property="og:image:alt" content="${esc(t("meta.ogAlt"))}">`,
    `<meta property="og:locale" content="${page.locale}">`,
    `<meta property="og:locale:alternate" content="${other.locale}">`,
    `<meta name="twitter:card" content="summary_large_image">`,
  ].join("\n");
}

// data-i18n 系の属性が付いた要素の中身を、その言語の文に差し替える
function applyStrings(html, t) {
  html = html.replace(/(<(\w+)\b[^>]*\sdata-i18n="([^"]+)"[^>]*>)([\s\S]*?)(<\/\2>)/g,
    (_, open, _tag, key, _body, close) => open + esc(t(key)) + close);
  html = html.replace(/(<(\w+)\b[^>]*\sdata-i18n-html="([^"]+)"[^>]*>)([\s\S]*?)(<\/\2>)/g,
    (_, open, _tag, key, _body, close) => open + t(key) + close);
  html = html.replace(/(\sdata-i18n-aria="([^"]+)"\s+aria-label=")[^"]*"/g, (_, pre, key) => pre + esc(t(key)) + '"');
  // はじめるボタンは data-i18n を持たず、セットアップ済みかどうかで top.js が文言を変える
  html = html.replace(/(<a\b[^>]*\bclass="[^"]*\bcta\b[^"]*"[^>]*>)[^<]*(<\/a>)/g, (_, open, close) => open + esc(t("cta.start")) + close);
  return html;
}

// 言語の切り替えリンクと、トップ以外への相対リンクを、そのページの場所に合わせる
function fixLinks(html, page) {
  const up = page.path ? "../" : "";
  html = html.replace(/<a href="[^"]*" hreflang="(\w+)" data-lang="\1"( class="on")?>/g, (_, l) => {
    const target = PAGES.find(p => p.lang === l);
    const href = page.path ? (target.path ? "./" : "../") : (target.path || "./");
    return `<a href="${href}" hreflang="${l}" data-lang="${l}"${l === page.lang ? ' class="on"' : ""}>`;
  });
  if (!page.path) return html;
  html = html.replace(/\b(href|src)="(?!https?:|#|\.\/"|\.\.\/|\/)([^"]+)"/g, (m, attr, ref) => {
    if (ref.startsWith("app.html")) ref = ref.replace(/^app\.html/, `app.html?lang=${page.lang}`);
    return `${attr}="${up}${ref}"`;
  });
  return html;
}

export function render(src, page) {
  const t = makeT(page.lang);
  let html = src
    .replace(/<html lang="\w+" data-page-lang="\w+">/, `<html lang="${page.lang}" data-page-lang="${page.lang}">`)
    .replace(/(<!--META-START[^>]*-->\n)[\s\S]*?(<!--META-END-->)/, (_, a, b) => `${a}${head(page, t)}\n${b}`);
  html = applyStrings(html, t);
  return fixLinks(html, page);
}

export function sitemap() {
  const alts = PAGES.map(p => `    <xhtml:link rel="alternate" hreflang="${p.lang}" href="${ORIGIN + p.path}"/>`).join("\n");
  const urls = PAGES.map(p => `  <url>\n    <loc>${ORIGIN + p.path}</loc>\n${alts}\n  </url>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${urls}\n</urlset>\n`;
}

export function build() {
  const src = readFileSync(new URL("index.html", root), "utf8");
  const out = PAGES.map(p => [p.file, render(src, p)]);
  out.push(["sitemap.xml", sitemap()]);
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const check = process.argv.includes("--check");
  let stale = [];
  for (const [file, body] of build()) {
    const url = new URL(file, root);
    let cur = null; try { cur = readFileSync(url, "utf8"); } catch {}
    if (cur === body) continue;
    if (check) { stale.push(file); continue; }
    mkdirSync(new URL(".", url), { recursive: true });
    writeFileSync(url, body);
    console.log("wrote", file);
  }
  if (stale.length) { console.error(`out of date: ${stale.join(", ")}\nrun: node scripts/build-pages.mjs`); process.exit(1); }
}
