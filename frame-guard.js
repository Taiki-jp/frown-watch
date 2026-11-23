// 他のサイトの iframe に埋め込まれたら動かさない (クリックジャッキング対策)。
// 本来は CSP の frame-ancestors で防ぐが、meta タグでは効かず、GitHub Pages ではヘッダーも付けられない。
// 各ページの最初の import にする。ここで投げると、import した側のモジュールは評価されず、ボタンに処理が付かない
if (window.top !== window.self) {
  const a = document.createElement("a");
  a.href = location.href; a.target = "_blank"; a.rel = "noopener";
  a.textContent = "Frown Watch を新しいタブで開く / Open Frown Watch in a new tab";
  const p = document.createElement("p");
  p.style.cssText = "font:16px system-ui,sans-serif;padding:24px";
  p.append(a);
  document.body.replaceChildren(p);
  throw new Error("[fw] framed by another page; refusing to run");
}
