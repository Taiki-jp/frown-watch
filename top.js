// トップページ。言語の切り替えと、セットアップ済みならボタンの文言を変える
import { LANGS, getLang, setLang, makeT, applyStatic } from "./i18n.js";
const VERSION = "0.3.0";
function apply(l) {
  const t = makeT(l); setLang(l);
  document.documentElement.lang = l;
  applyStatic(document, t);
  let onboarded = false;
  try { onboarded = !!JSON.parse(localStorage.getItem("fw.settings") || "null")?.onboarded; } catch {}
  for (const a of document.querySelectorAll("a.cta")) a.textContent = t(onboarded ? "cta.open" : "cta.start");
  document.getElementById("version").textContent = t("footer.version", { v: VERSION });
  for (const b of document.querySelectorAll("#lang button")) b.classList.toggle("on", b.dataset.lang === l);
}
document.getElementById("lang").addEventListener("click", e => {
  const b = e.target.closest("button");
  if (b && LANGS.includes(b.dataset.lang)) apply(b.dataset.lang);
});
apply(getLang());
