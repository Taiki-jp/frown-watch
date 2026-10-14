// index.html の判定ロジック（PURE ブロック）だけを取り出して検証する
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";

const html = readFileSync(new URL("../app.js", import.meta.url), "utf8");
const m = html.match(/\/\*PURE-START\*\/([\s\S]*?)\/\*PURE-END\*\//);
assert.ok(m, "PURE block not found");
const { TARGETS, stepTarget, newTargetState } = new Function(m[1] + "\nreturn { TARGETS, stepTarget, newTargetState };")();

const cfg = { threshold: 0.3, duration: 2, cooldown: 45 };
function simulate(segments) { // 10fps で [score, 秒] を順に流す
  const st = newTargetState(); let t = 0; const ev = [];
  for (const [score, sec] of segments) for (let i = 0; i < Math.round(sec * 10); i++) {
    t += 100;
    const o = stepTarget(st, score, t, 0.1, cfg);
    if (o.episodeStart) ev.push(`start@${(t / 1000).toFixed(1)}`);
    if (o.alert) ev.push(`alert@${(t / 1000).toFixed(1)}`);
  }
  return ev;
}

// 1 秒だけの顰めは数えない
assert.deepEqual(simulate([[0.05, 2], [0.6, 1], [0.05, 2]]), []);
// 3 秒続けば 1 回。休止 45 秒以内の 2 回目は回数だけ増えて音は鳴らない
const ev = simulate([[0.05, 2], [0.6, 3], [0.05, 2], [0.6, 3], [0.05, 1]]);
assert.equal(ev.filter(e => e.startsWith("start")).length, 2, ev.join(","));
assert.equal(ev.filter(e => e.startsWith("alert")).length, 1, ev.join(","));
// 休止を過ぎれば再び鳴る
const ev2 = simulate([[0.6, 3], [0.05, 50], [0.6, 3]]);
assert.equal(ev2.filter(e => e.startsWith("alert")).length, 2, ev2.join(","));
// しきい値付近で揺れても解除されない（ヒステリシス）
const ev3 = simulate([[0.6, 3], [0.25, 3], [0.6, 1]]);
assert.equal(ev3.filter(e => e.startsWith("start")).length, 1, ev3.join(","));
// score 関数は 0〜1 の数値を返す
for (const [k, t] of Object.entries(TARGETS)) { const s = t.score(() => 0.5); assert.ok(Number.isFinite(s) && s >= 0 && s <= 1, k); }
// 笑顔のとき目元は数えない
assert.equal(TARGETS.squint.score(n => n.startsWith("mouthSmile") ? 0.8 : 0.6), 0);
console.log("logic tests passed:", ev.join(", "), "|", ev2.join(", "), "|", ev3.join(", "));
