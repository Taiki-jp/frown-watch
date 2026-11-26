// トップページ。言語は URL で決まる (/ が日本語、/en/ が英語)。中身は scripts/build-pages.mjs が書き出し済み。
// ここではセットアップ済みならボタンの文言を変え、選んだ言語をアプリ側 (app.html) に引き継ぐ
import "./frame-guard.js";
import { LANGS, setLang, makeT } from "./i18n.js";
const VERSION = "0.3.0";
const page = document.documentElement.dataset.pageLang;

// 以前の ?lang=en のリンクは、その言語のページへ移す
const q = new URLSearchParams(location.search).get("lang");
const target = q && LANGS.includes(q) && q !== page ? document.querySelector(`#lang a[data-lang="${q}"]`) : null;
if (target) {
  location.replace(target.href + location.hash);
} else {
  const t = makeT(page); setLang(page);
  let onboarded = false;
  try { onboarded = !!JSON.parse(localStorage.getItem("fw.settings") || "null")?.onboarded; } catch {}
  if (onboarded) for (const a of document.querySelectorAll("a.cta")) a.textContent = t("cta.open");
  document.getElementById("version").textContent = t("footer.version", { v: VERSION });
  document.getElementById("lang").addEventListener("click", e => {
    const a = e.target.closest("a[data-lang]");
    if (a && LANGS.includes(a.dataset.lang)) setLang(a.dataset.lang);
  });
}
