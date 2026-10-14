// トップページ。セットアップ済みなら「はじめる」を「アプリを開く」に変える
try {
  const s = JSON.parse(localStorage.getItem("fw.settings") || "null");
  if (s?.onboarded) for (const a of document.querySelectorAll("a.cta")) a.textContent = "アプリを開く";
} catch {}
document.getElementById("version").textContent = "v0.2.0 試作";
