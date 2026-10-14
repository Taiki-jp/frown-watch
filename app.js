import { FaceLandmarker, FilesetResolver } from "./vendor/mediapipe/vision_bundle.mjs";
import { LANGS, getLang, setLang, makeT, applyStatic } from "./i18n.js";

const MP_WASM = "./vendor/mediapipe/wasm";
const MODEL_URL = "./vendor/models/face_landmarker.task";
const PROCESS_INTERVAL_MS = 100; // 約 10fps
const CALIB_MS = 3000;
const APP_VERSION = "0.3.0";

let lang = getLang();
let t = makeT(lang);

/*PURE-START*/
const avg = (...xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
const clamp01 = x => Math.max(0, Math.min(1, x));

// 見守る癖。score は blendshape の値を返す関数 v(name) から癖の強さ（0〜1）を作る。表示名は辞書の habit.<key>
const TARGETS = {
  glabella: { defaults: { on: true, threshold: 0.30, duration: 2, cooldown: 60 },
    score: v => avg(v("browDownLeft"), v("browDownRight")) },
  forehead: { defaults: { on: true, threshold: 0.35, duration: 2, cooldown: 60 },
    score: v => Math.max(v("browInnerUp"), avg(v("browOuterUpLeft"), v("browOuterUpRight"))) },
  squint: { defaults: { on: true, threshold: 0.20, duration: 2, cooldown: 60 },
    score: v => avg(v("mouthSmileLeft"), v("mouthSmileRight")) > 0.4 ? 0 : avg(v("eyeSquintLeft"), v("eyeSquintRight")) },
  mouth: { defaults: { on: true, threshold: 0.30, duration: 3, cooldown: 60 },
    score: v => avg(v("mouthFrownLeft"), v("mouthFrownRight")) },
  jaw: { defaults: { on: true, threshold: 0.25, duration: 5, cooldown: 60 },
    score: v => v("jawOpen") },
};

const EMA_ALPHA = 0.35;    // 平滑化。1 に近いほど生の値に追従する
const RELEASE_RATIO = 0.7; // しきい値のこの割合を下回ったら解除

function newTargetState() { return { ema: 0, aboveSince: null, active: false, lastAlertAt: -Infinity }; }

// 1 フレーム分進める。score は基準を引いた後の値、now はミリ秒、dt は前フレームからの秒
function stepTarget(st, score, now, dt, cfg) {
  st.ema += EMA_ALPHA * (score - st.ema);
  const out = { episodeStart: false, alert: false, activeSec: 0 };
  if (st.ema >= cfg.threshold) {
    if (st.aboveSince == null) st.aboveSince = now;
    if (!st.active && now - st.aboveSince >= cfg.duration * 1000) {
      st.active = true;
      out.episodeStart = true;
      if (now - st.lastAlertAt >= cfg.cooldown * 1000) { st.lastAlertAt = now; out.alert = true; }
    }
  } else if (st.ema < cfg.threshold * RELEASE_RATIO) {
    st.aboveSince = null;
    st.active = false;
  }
  if (st.active) out.activeSec = dt;
  return out;
}
/*PURE-END*/
const habitLabel = k => t("habit." + k);
const habitDesc = k => t("habit." + k + ".desc");

// 拡大して映す部位。MediaPipe Face Landmarker の landmark 番号で囲む範囲を決める。表示名は辞書の roi.<key>
// 左右は鏡に映った自分から見た向き（右＝画面の右側）
const ROIS = {
  glabella: { idx: [107, 55, 193, 336, 285, 417, 9, 8, 168, 151, 66, 296], pad: 0.6 },
  forehead: { idx: [10, 109, 338, 67, 297, 103, 332, 105, 334, 66, 296, 107, 336], pad: 0.3 },
  eyeR: { idx: [33, 130, 226, 113, 247, 143, 35, 124, 156, 7, 25, 110, 31, 111], pad: 0.6 },
  eyeL: { idx: [263, 359, 446, 342, 467, 372, 265, 353, 383, 249, 255, 339, 261, 340], pad: 0.6 },
  nasoR: { idx: [98, 205, 61, 206, 203, 216, 212, 207, 187, 50, 92, 165, 186, 185, 40], pad: 0.4 },
  nasoL: { idx: [327, 425, 291, 426, 423, 436, 432, 427, 411, 280, 322, 391, 410, 409, 270], pad: 0.4 },
  mouth: { idx: [61, 291, 0, 17, 37, 267, 84, 314, 40, 270, 91, 321], pad: 0.5 },
};

// ---------- 診断用の幾何特徴 ----------
// landmark は正規化座標（x, y は 0〜1、z は x と同じ尺度）。3D の距離で測るので顔の向きの影響が小さい
function p3(lm, i, vw, vh) { const p = lm[i]; return [p.x * vw, p.y * vh, p.z * vw]; }
function dist3(a, b) { return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]); }
function mid3(a, b) { return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2]; }
function geoFeatures(lm, vw, vh) {
  const P = i => p3(lm, i, vw, vh);
  const browR = mid3(P(107), P(55)), browL = mid3(P(336), P(285)); // 眉頭（眉の内側の端）
  const eyeMid = mid3(P(133), P(362));                              // 目頭の中点
  const iod = dist3(P(33), P(263));                                 // 目尻から目尻。表情で動かない
  const eyeToNose = dist3(eyeMid, P(2));                            // 目頭の中点から鼻の下。表情で動かない
  return {
    gap: dist3(browR, browL) / iod,                      // 眉頭の間隔。寄せると小さくなる
    drop: dist3(mid3(browR, browL), eyeMid) / eyeToNose, // 眉頭の高さ。下げると小さくなる
  };
}
const DIAG_BLEND = ["browDownLeft", "browDownRight", "browInnerUp", "browOuterUpLeft", "browOuterUpRight",
  "eyeSquintLeft", "eyeSquintRight", "eyeBlinkLeft", "eyeBlinkRight", "cheekSquintLeft", "cheekSquintRight",
  "noseSneerLeft", "noseSneerRight", "mouthFrownLeft", "mouthFrownRight", "jawOpen"];
// 眉間の皮膚だけを囲む箱。眉毛を含めないよう、眉頭の内側の端の間に限る
function glabellaSkinBox(lm, vw, vh) {
  const x0 = lm[55].x * vw, x1 = lm[285].x * vw;    // 眉頭の内側の端
  const yTop = Math.min(lm[107].y, lm[336].y) * vh;   // 眉頭の上端
  const yBot = lm[168].y * vh;                        // 目と目の間
  const w = x1 - x0, h = yBot - yTop;
  return { sx: x0 + w * 0.15, sy: yTop + h * 0.1, sw: w * 0.7, sh: h * 0.9 };
}
// RGBA の画素列から、しわの手がかりになる値を出す
//   luma: 平均輝度（0〜255）。暗さの目安
//   energy: 輝度で正規化した輪郭の強さ。しわが寄ると増える
//   vertical: 輪郭のうち縦線の割合（0〜1）。眉間の縦じわで増える
function textureFromPixels(d, W, H) {
  const g = new Float32Array(W * H); let sum = 0;
  for (let i = 0; i < W * H; i++) { const v = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2]; g[i] = v; sum += v; }
  const luma = sum / (W * H);
  const b = new Float32Array(W * H); // 3x3 平均で雑音を抑える
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    let acc = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) acc += g[(y + dy) * W + x + dx];
    b[y * W + x] = acc / 9;
  }
  let ex = 0, ey = 0, n = 0;
  for (let y = 2; y < H - 2; y++) for (let x = 2; x < W - 2; x++) {
    const i = y * W + x;
    ex += Math.abs(b[i + 1] - b[i - 1]); ey += Math.abs(b[i + W] - b[i - W]); n++;
  }
  return { luma, energy: (ex + ey) / n / (luma + 1) * 100, vertical: ex / (ex + ey + 1e-6) };
}
const TEX_W = 48, TEX_H = 48;
let texCtx = null;
function textureScore(lm, vw, vh) {
  const bx = glabellaSkinBox(lm, vw, vh);
  if (!(bx.sw >= 4 && bx.sh >= 4)) return null;
  if (!texCtx) {
    const c = document.createElement("canvas"); c.width = TEX_W; c.height = TEX_H;
    texCtx = c.getContext("2d", { willReadFrequently: true });
  }
  texCtx.drawImage(els.video, bx.sx, bx.sy, bx.sw, bx.sh, 0, 0, TEX_W, TEX_H);
  return textureFromPixels(texCtx.getImageData(0, 0, TEX_W, TEX_H).data, TEX_W, TEX_H);
}
const lumaKey = l => l < 50 ? "luma.dark" : l < 90 ? "luma.dim" : l > 200 ? "luma.bright" : "luma.ok";

const diag = { scores: null, geo: null, tex: null, peaks: {} }; // peaks: 名前 -> 直近 3 秒の { t, v }
function pushPeak(name, v, now) {
  const arr = (diag.peaks[name] ??= []);
  arr.push({ t: now, v });
  while (arr.length && now - arr[0].t > 3000) arr.shift();
}
function peakOf(name, fn = Math.max) {
  const arr = diag.peaks[name];
  if (!arr?.length) return null;
  return arr.reduce((m, e) => fn(m, e.v), arr[0].v);
}

// ---------- 保存 ----------
const loadJSON = (k, def) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : def; } catch { return def; } };
const saveJSON = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };

const SENSITIVITY = { sensitive: 0.7, normal: 1, relaxed: 1.4 }; // しきい値に掛ける係数
const SETTINGS_VERSION = 3; // 2: 見守る癖を全部オンにした / 3: 目元のしきい値を 0.35 から 0.20 に下げた
const round2 = x => Math.round(x * 100) / 100;

function defaultSettings() {
  const targets = {};
  for (const [k, tg] of Object.entries(TARGETS)) targets[k] = { ...tg.defaults };
  return { version: SETTINGS_VERSION, onboarded: false, sensitivity: "normal", sound: true, notify: false, focus: "glabella", targets };
}
function loadSettings() {
  const d = defaultSettings();
  const s = loadJSON("fw.settings", null);
  if (!s) return d;
  const targets = {};
  for (const k of Object.keys(TARGETS)) targets[k] = { ...d.targets[k], ...(s.targets?.[k] || {}) };
  if ((s.version ?? 1) < 2) for (const k of Object.keys(TARGETS)) targets[k].on = true; // 古い設定は初期値に合わせる
  if ((s.version ?? 1) < 3) targets.squint.threshold = round2(TARGETS.squint.defaults.threshold * (SENSITIVITY[s.sensitivity] ?? 1)); // 目元は敏感さの段階を保ったまま下げる
  return { ...d, ...s, targets, version: SETTINGS_VERSION };
}
const settings = loadSettings();
const saveSettings = () => saveJSON("fw.settings", settings);

let baseline = loadJSON("fw.baseline", null); // { at, values: { key: number }, geo, tex }
const stats = loadJSON("fw.stats", {});       // { "YYYY-MM-DD": { faceSec, noFaceSec, targets: { key: { count, sec } } } }
const saveStats = () => saveJSON("fw.stats", stats);

function emptyDay() {
  const targets = {};
  for (const k of Object.keys(TARGETS)) targets[k] = { count: 0, sec: 0 };
  return { faceSec: 0, noFaceSec: 0, targets };
}
for (const day of Object.values(stats)) { // 癖の種類が増えたときに古い記録を補う
  day.targets ??= {}; day.faceSec ??= 0; day.noFaceSec ??= 0;
  for (const k of Object.keys(TARGETS)) day.targets[k] ??= { count: 0, sec: 0 };
}
function dateKey(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
const parseKey = dk => { const [y, m, d] = dk.split("-").map(Number); return new Date(y, m - 1, d); };
const lastDays = n => { const out = []; for (let i = n - 1; i >= 0; i--) { const d = new Date(); d.setDate(d.getDate() - i); out.push(dateKey(d)); } return out; };
const todayStats = () => (stats[dateKey()] ??= emptyDay());
const fmtMin = sec => (sec / 60).toFixed(1);
const enabledKeys = () => Object.keys(TARGETS).filter(k => settings.targets[k].on);
const dayCount = (s, keys = enabledKeys()) => keys.reduce((a, k) => a + (s.targets[k]?.count ?? 0), 0);

// ---------- 要素 ----------
const $ = id => document.getElementById(id);
const els = {};
for (const id of ["statusPill", "lang", "onboarding", "main", "stepper", "obStageHost", "obCameraStatus", "obCamera", "obCameraNext",
  "obCalibStageHost", "calibBar", "calibCount", "calibDone", "countdown", "obCalibStatus", "obCalib", "obCalibNext", "obPipNote", "obPip", "obFinish",
  "envCheckBtn", "envResult", "envCheckBtn2", "envResult2", "version", "privacy", "linkPrivacy", "linkEnv", "mainStageHost",
  "stage", "video", "overlay", "inset", "insetLabel", "alertLabel", "meters", "hudStatus", "hudCount",
  "btnStart", "btnPip", "btnStop", "status", "todayCount", "todayRate", "todayMinutes", "todayBreakdown", "trend", "chart", "history",
  "habitChips", "sensitivity", "cooldownSel", "focusArea", "baselineInfo", "btnCalib", "targets", "btnOnboarding",
  "diag", "btnCsv", "btnReset"]) els[id] = $(id);
const all = sel => [...document.querySelectorAll(sel)];

// ---------- 実行状態 ----------
let landmarker = null, stream = null, running = false, pipWindow = null, currentHost = null, obStep = 1;
let loopGen = 0, lastProcess = 0, lastTick = null, lastUi = 0, lastStatsRender = 0, frameCount = 0;
let calib = null; // { until, sums, geo, tex, n, texN }
let audioCtx = null;
let currentState = "off", currentMode = "idle";
const envResults = new Map(); // 表示先の要素 -> 直近の確認結果。言語を切り替えたときに描き直す
const states = {};
const liveEff = {};
const resetStates = () => { for (const k of Object.keys(TARGETS)) states[k] = newTargetState(); };
resetStates();

// ---------- 状態の表示 ----------
const PILL = { off: "", loading: "pill-warn", on: "pill-on", pip: "pill-on", noface: "pill-warn", dark: "pill-warn", calib: "pill-warn" };
function setState(kind) {
  currentState = kind;
  els.statusPill.className = "pill " + PILL[kind];
  els.statusPill.textContent = t("state." + kind);
  els.hudStatus.textContent = kind === "pip" ? t("state.on") : t("state." + kind);
}
function setStatus(msg) {
  els.status.textContent = msg;
  if (!els.onboarding.hidden) {
    if (obStep === 2) els.obCameraStatus.textContent = msg;
    if (obStep === 3) els.obCalibStatus.textContent = msg;
  }
}
const pipSupported = () => "documentPictureInPicture" in window;

// カメラ画面をどこに置くか。小窓に出ている間は戻り先だけ覚えておく
function mountStage(host) {
  currentHost = host;
  if (!pipWindow && els.stage.parentElement !== host) host.append(els.stage);
  updatePlaceholder();
}
function updatePlaceholder() {
  for (const ph of document.querySelectorAll(".stage-placeholder")) ph.remove();
  if (pipWindow && currentHost) currentHost.insertAdjacentHTML("beforeend", `<div class="stage-placeholder">${t("stage.placeholder")}</div>`);
}
// セットアップのカメラ許可ボタン。許可できたらチェック印にして押せなくする
function setCameraButton(done, loading = false) {
  els.obCamera.disabled = done || loading;
  els.obCamera.classList.toggle("done", done);
  els.obCamera.textContent = done ? t("ob2.allowed") : loading ? t("ob2.starting") : t("ob2.allow");
}

// ---------- 設定の UI ----------
function buildTargetTable() {
  const rows = Object.entries(TARGETS).map(([k]) => {
    const c = settings.targets[k];
    return `<tr data-key="${k}">
      <td><label class="chk"><input type="checkbox" data-f="on" ${c.on ? "checked" : ""}> <b>${habitLabel(k)}</b></label><br><small class="k">${habitDesc(k)}</small></td>
      <td class="num"><span class="live" data-live="${k}">–</span></td>
      <td><input type="range" data-f="threshold" min="0.05" max="0.9" step="0.05" value="${c.threshold}"> <span data-v="threshold">${c.threshold.toFixed(2)}</span></td>
      <td><input type="number" data-f="duration" min="0.5" max="60" step="0.5" value="${c.duration}"> ${t("unit.sec")}</td>
      <td><input type="number" data-f="cooldown" min="0" max="900" step="5" value="${c.cooldown}"> ${t("unit.sec")}</td>
    </tr>`;
  }).join("");
  els.targets.innerHTML = `<thead><tr><th>${t("tbl.habit")}</th><th class="num">${t("tbl.now")}</th><th>${t("tbl.threshold")}</th><th>${t("tbl.duration")}</th><th>${t("tbl.cooldown")}</th></tr></thead><tbody>${rows}</tbody>`;
  updateLiveValues();
}
els.targets.addEventListener("input", e => {
  const tr = e.target.closest("tr"); const f = e.target.dataset.f;
  if (!tr || !f) return;
  const k = tr.dataset.key;
  const v = f === "on" ? e.target.checked : parseFloat(e.target.value);
  if (f !== "on" && !Number.isFinite(v)) return;
  settings.targets[k][f] = v;
  if (f === "threshold") tr.querySelector('[data-v="threshold"]').textContent = v.toFixed(2);
  if (f === "on") states[k] = newTargetState();
  saveSettings(); renderSettings(); buildMeters(); renderStats();
});

function buildMeters() {
  els.meters.innerHTML = Object.keys(TARGETS).filter(k => settings.targets[k].on).map(k =>
    `<div class="meter" data-key="${k}"><span class="m-label">${habitLabel(k)}</span><div class="m-bar"><div class="m-fill"></div><div class="m-th" style="left:${settings.targets[k].threshold * 100}%"></div></div></div>`
  ).join("");
}
function updateMeters() {
  for (const m of els.meters.querySelectorAll(".meter")) {
    const k = m.dataset.key;
    m.querySelector(".m-fill").style.width = `${clamp01(states[k].ema) * 100}%`;
    m.classList.toggle("over", states[k].active);
  }
}

function buildFocusSelect() {
  if (!(settings.focus in ROIS) && settings.focus !== "none") settings.focus = "none";
  els.focusArea.innerHTML = `<option value="none">${t("roi.none")}</option>` + Object.keys(ROIS).map(k => `<option value="${k}">${t("roi." + k)}</option>`).join("");
  els.focusArea.value = settings.focus;
  applyFocus();
}
els.focusArea.addEventListener("change", () => { settings.focus = els.focusArea.value; saveSettings(); applyFocus(); });
function applyFocus() {
  const roi = ROIS[settings.focus];
  els.stage.classList.toggle("has-inset", !!roi);
  els.insetLabel.textContent = roi ? t("roi." + settings.focus) : "";
}

// しきい値が「敏感・標準・鈍感」のどれに当たるか。手で変えてあればどれでもない
function detectSensitivity() {
  for (const [name, f] of Object.entries(SENSITIVITY)) {
    if (Object.keys(TARGETS).every(k => Math.abs(settings.targets[k].threshold - round2(TARGETS[k].defaults.threshold * f)) < 0.001)) return name;
  }
  return null;
}
function applySensitivity(name) {
  settings.sensitivity = name;
  for (const k of Object.keys(TARGETS)) settings.targets[k].threshold = round2(TARGETS[k].defaults.threshold * SENSITIVITY[name]);
  resetStates();
}

// 設定の表示をまとめて更新する。チップ、敏感さ、間隔、トグル、基準
function renderSettings() {
  els.habitChips.innerHTML = Object.keys(TARGETS).map(k =>
    `<button class="chip ${settings.targets[k].on ? "on" : ""}" data-k="${k}" title="${habitDesc(k)}">${habitLabel(k)}</button>`).join("");
  const sens = detectSensitivity();
  for (const b of els.sensitivity.querySelectorAll("button")) b.classList.toggle("on", b.dataset.v === sens);
  const cds = Object.keys(TARGETS).map(k => settings.targets[k].cooldown);
  const same = cds.every(c => c === cds[0]);
  const custom = els.cooldownSel.querySelector('option[value="custom"]');
  if (same && [...els.cooldownSel.options].some(o => o.value === String(cds[0]))) { custom?.remove(); els.cooldownSel.value = String(cds[0]); }
  else { if (!custom) els.cooldownSel.insertAdjacentHTML("beforeend", `<option value="custom">${t("interval.custom")}</option>`); els.cooldownSel.value = "custom"; }
  for (const el of all(".optSound")) el.checked = settings.sound;
  for (const el of all(".optNotify")) el.checked = settings.notify;
  if (!baseline) els.baselineInfo.textContent = t("baseline.none");
  else {
    const when = new Date(baseline.at);
    const date = `${when.getMonth() + 1}/${when.getDate()} ${String(when.getHours()).padStart(2, "0")}:${String(when.getMinutes()).padStart(2, "0")}`;
    const parts = Object.keys(TARGETS).map(k => `${habitLabel(k)} ${(baseline.values[k] ?? 0).toFixed(2)}`).join(" / ");
    els.baselineInfo.textContent = t("baseline.at", { date, parts }) + (baseline.geo ? t("baseline.geo", { gap: baseline.geo.gap.toFixed(3), drop: baseline.geo.drop.toFixed(3) }) : "");
  }
}
els.habitChips.addEventListener("click", e => {
  const b = e.target.closest(".chip"); if (!b) return;
  const k = b.dataset.k;
  settings.targets[k].on = !settings.targets[k].on; states[k] = newTargetState();
  saveSettings(); renderSettings(); buildTargetTable(); buildMeters(); renderStats();
});
els.sensitivity.addEventListener("click", e => {
  const b = e.target.closest("button"); if (!b) return;
  applySensitivity(b.dataset.v); saveSettings(); renderSettings(); buildTargetTable(); buildMeters();
});
els.cooldownSel.addEventListener("change", () => {
  const v = parseInt(els.cooldownSel.value, 10); if (!Number.isFinite(v)) return;
  for (const k of Object.keys(TARGETS)) settings.targets[k].cooldown = v;
  saveSettings(); renderSettings(); buildTargetTable();
});

// ---------- 記録の表示 ----------
// 1 時間あたりの回数。5 分以上見守った日だけ出す
function rateOf(s) { return s && s.faceSec >= 300 ? dayCount(s) / (s.faceSec / 3600) : null; }
function trendText() {
  const days = lastDays(14);
  const prev = days.slice(0, 7).map(dk => rateOf(stats[dk])).filter(v => v != null);
  const cur = days.slice(7).map(dk => rateOf(stats[dk])).filter(v => v != null);
  if (cur.length < 2 || prev.length < 2) return { cls: "na", text: t("trend.na") };
  const a = avg(...cur), b = avg(...prev);
  const rate = a.toFixed(1);
  if (b === 0) return { cls: "na", text: t("trend.lastZero", { rate }) };
  const diff = (a / b - 1) * 100;
  if (Math.abs(diff) < 5) return { cls: "na", text: t("trend.same", { rate }) };
  return { cls: diff < 0 ? "down" : "up", text: t(diff < 0 ? "trend.less" : "trend.more", { pct: Math.abs(diff).toFixed(0), rate }) };
}
function renderStats() {
  const day = todayStats();
  const keys = enabledKeys();
  const count = dayCount(day, keys);
  const hours = day.faceSec / 3600;
  els.todayCount.textContent = count;
  els.todayRate.textContent = day.faceSec >= 300 ? (count / hours).toFixed(1) : "–";
  els.todayMinutes.textContent = Math.round(day.faceSec / 60);
  els.todayBreakdown.textContent = keys.length
    ? keys.map(k => t("stats.item", { label: habitLabel(k), count: day.targets[k].count, sec: Math.round(day.targets[k].sec) })).join(" ・ ")
    : t("stats.noHabits");
  const tr = trendText();
  els.trend.className = "trend " + tr.cls; els.trend.textContent = tr.text;

  const days = lastDays(14);
  const vals = days.map(dk => stats[dk] ? dayCount(stats[dk], keys) : null);
  const max = Math.max(1, ...vals.filter(v => v != null));
  const empty = vals.every(v => v == null);
  els.chart.innerHTML = (empty ? `<div class="chart-empty">${t("chart.empty")}</div>` : "") + days.map((dk, i) => {
    const v = vals[i]; const d = parseKey(dk);
    const mins = stats[dk] ? Math.round(stats[dk].faceSec / 60) : 0;
    const label = (i % 2 === 1) ? `${d.getMonth() + 1}/${d.getDate()}` : "";
    const h = v == null ? 0 : Math.max(2, v / max * 100);
    return `<div class="bar-col" title="${t("chart.tip", { date: dk, count: v ?? 0, mins })}"><div class="bar-track"><div class="bar ${i === 13 ? "today" : ""} ${v == null ? "empty" : ""}" style="height:${h}%"></div></div><div class="bar-val">${v == null || !mins ? "" : t("chart.min", { mins })}</div><div class="bar-label">${label}</div></div>`;
  }).join("");

  const allKeys = Object.keys(TARGETS);
  els.history.innerHTML = `<thead><tr><th>${t("hist.date")}</th>${allKeys.map(k => `<th class="num">${habitLabel(k)}</th>`).join("")}<th class="num">${t("hist.minutes")}</th><th class="num">${t("hist.rate")}</th></tr></thead><tbody>` +
    [...days].reverse().map(dk => {
      const s = stats[dk]; if (!s) return "";
      const r = rateOf(s);
      return `<tr><td>${dk.slice(5).replace("-", "/")}</td>${allKeys.map(k => `<td class="num">${s.targets[k].count}</td>`).join("")}<td class="num">${fmtMin(s.faceSec)}</td><td class="num">${r == null ? "–" : r.toFixed(1)}</td></tr>`;
    }).join("") + `</tbody>`;
}

function updateLiveValues() {
  for (const k of Object.keys(TARGETS)) {
    const el = els.targets.querySelector(`[data-live="${k}"]`);
    if (el) el.textContent = liveEff[k] == null ? "–" : liveEff[k].toFixed(2);
  }
}

function renderDiag() {
  if (!diag.scores || !diag.geo) { els.diag.innerHTML = `<tbody><tr><td class="muted">${t("diag.waiting")}</td></tr></tbody>`; return; }
  const pct = x => `${x >= 0 ? "+" : ""}${x.toFixed(0)}%`;
  const bsRows = DIAG_BLEND.map(n => {
    const v = diag.scores[n] ?? 0; const pk = peakOf(n) ?? v;
    return `<tr><td><code>${n}</code></td><td class="num">${v.toFixed(2)}</td><td class="num">${pk.toFixed(2)}</td><td><div class="dbar"><div style="width:${clamp01(v) * 100}%"></div></div></td></tr>`;
  }).join("");
  const geoRow = (key, label) => {
    const v = diag.geo[key]; const base = baseline?.geo?.[key]; const pk = peakOf("geo:" + key, Math.min);
    const note = base ? t("diag.base", { pct: pct((v / base - 1) * 100), pk: pct((pk / base - 1) * 100) }) : `<small class="k">${t("diag.baseHint")}</small>`;
    return `<tr><td>${label}</td><td class="num">${v.toFixed(3)}</td><td class="num">${pk == null ? "–" : pk.toFixed(3)}</td><td>${note}</td></tr>`;
  };
  let texRows = "";
  if (diag.tex) {
    const tx = diag.tex, bt = baseline?.tex;
    const pkE = peakOf("tex:energy") ?? tx.energy, pkV = peakOf("tex:vertical") ?? tx.vertical;
    texRows = `<tr><td>${t("diag.luma")}</td><td class="num">${tx.luma.toFixed(0)}</td><td class="num">/ 255</td><td>${t(lumaKey(tx.luma))}</td></tr>` +
      `<tr><td>${t("diag.energy")}</td><td class="num">${tx.energy.toFixed(2)}</td><td class="num">${pkE.toFixed(2)}</td><td>${bt ? t("diag.energyBase", { pct: pct((tx.energy / bt.energy - 1) * 100), pk: pct((pkE / bt.energy - 1) * 100) }) : `<small class="k">${t("diag.baseHint")}</small>`}</td></tr>` +
      `<tr><td>${t("diag.vertical")}</td><td class="num">${tx.vertical.toFixed(2)}</td><td class="num">${pkV.toFixed(2)}</td><td>${bt ? t("diag.verticalDiff", { d: `${tx.vertical - bt.vertical >= 0 ? "+" : ""}${(tx.vertical - bt.vertical).toFixed(2)}` }) : ""}</td></tr>`;
  }
  els.diag.innerHTML = `<thead><tr><th>${t("diag.blend")}</th><th class="num">${t("diag.now")}</th><th class="num">${t("diag.max3")}</th><th></th></tr></thead><tbody>${bsRows}</tbody>` +
    `<thead><tr><th>${t("diag.geo")}</th><th class="num">${t("diag.now")}</th><th class="num">${t("diag.min3")}</th><th></th></tr></thead><tbody>${geoRow("gap", t("diag.gap"))}${geoRow("drop", t("diag.drop"))}</tbody>` +
    `<thead><tr><th>${t("diag.pixels")}</th><th class="num">${t("diag.now")}</th><th class="num">${t("diag.max3")}</th><th></th></tr></thead><tbody>${texRows}</tbody>`;
}

function updateAlertUI() {
  if (calib) { els.stage.classList.remove("alert"); els.alertLabel.textContent = t("alert.calib"); return; }
  const active = Object.keys(TARGETS).filter(k => settings.targets[k].on && states[k].active);
  els.stage.classList.toggle("alert", active.length > 0);
  els.alertLabel.textContent = active.length ? t("alert.tense", { labels: active.map(habitLabel).join(lang === "ja" ? "・" : ", ") }) : "";
  const day = todayStats();
  els.hudCount.textContent = t("hud.today") + " " + enabledKeys().map(k => `${habitLabel(k)} ${day.targets[k].count}`).join(" / ");
}

// ---------- 知らせる ----------
function ensureAudio() {
  try {
    audioCtx ??= new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === "suspended") audioCtx.resume();
  } catch (e) { console.warn("[fw] audio unavailable", e); }
}
function playChime() {
  if (!audioCtx) return;
  const t0 = audioCtx.currentTime;
  [880, 660].forEach((f, i) => {
    const o = audioCtx.createOscillator(); const g = audioCtx.createGain();
    const at = t0 + i * 0.18;
    o.type = "sine"; o.frequency.value = f;
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(0.25, at + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, at + 0.28);
    o.connect(g).connect(audioCtx.destination);
    o.start(at); o.stop(at + 0.3);
  });
}
function notify(k) {
  if (settings.sound) { ensureAudio(); playChime(); }
  if (settings.notify && "Notification" in window && Notification.permission === "granted") {
    try {
      const n = new Notification(t("notify.title", { label: habitLabel(k) }), { body: t("notify.body"), tag: "frown-watch", silent: !!settings.sound });
      setTimeout(() => n.close(), 5000);
    } catch (e) { console.warn("[fw] notification failed", e); }
  }
}
function flashStage(label) {
  els.stage.classList.add("alert");
  els.alertLabel.textContent = label;
  setTimeout(() => { if (!Object.keys(TARGETS).some(k => states[k].active)) { els.stage.classList.remove("alert"); els.alertLabel.textContent = ""; } }, 1500);
}

// ---------- 判定ループ ----------
function roiBox(landmarks, roi, vw, vh) {
  let x0 = 1, y0 = 1, x1 = 0, y1 = 0;
  for (const i of roi.idx) {
    const p = landmarks[i]; if (!p) continue;
    x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y);
  }
  let w = (x1 - x0) * vw * (1 + roi.pad * 2), h = (y1 - y0) * vh * (1 + roi.pad * 2);
  const cx = (x0 + x1) / 2 * vw, cy = (y0 + y1) / 2 * vh;
  if (w / h > 4 / 3) h = w * 3 / 4; else w = h * 4 / 3;
  const sx = Math.max(0, Math.min(cx - w / 2, vw - w)), sy = Math.max(0, Math.min(cy - h / 2, vh - h));
  return { sx, sy, sw: Math.min(w, vw), sh: Math.min(h, vh) };
}

function drawOverlay(landmarks) {
  const vw = els.video.videoWidth, vh = els.video.videoHeight;
  if (!vw || !vh) return;
  if (els.overlay.width !== vw || els.overlay.height !== vh) { els.overlay.width = vw; els.overlay.height = vh; }
  const ctx = els.overlay.getContext("2d");
  ctx.clearRect(0, 0, vw, vh);
  const roi = ROIS[settings.focus];
  if (!roi || !landmarks) return;
  const b = roiBox(landmarks, roi, vw, vh);
  ctx.strokeStyle = "rgba(255,255,255,.85)"; ctx.lineWidth = Math.max(2, vw / 400);
  ctx.strokeRect(b.sx, b.sy, b.sw, b.sh);
  const ic = els.inset, iw = 320, ih = 240;
  if (ic.width !== iw || ic.height !== ih) { ic.width = iw; ic.height = ih; }
  const ictx = ic.getContext("2d");
  ictx.save(); ictx.scale(-1, 1); // 鏡と同じ向きにする
  ictx.drawImage(els.video, b.sx, b.sy, b.sw, b.sh, -iw, 0, iw, ih);
  ictx.restore();
}

function startCalib() {
  if (!running) return;
  calib = { until: performance.now() + CALIB_MS, sums: {}, geo: { gap: 0, drop: 0 }, tex: { energy: 0, vertical: 0 }, n: 0, texN: 0 };
  resetStates();
  els.calibBar.style.width = "0%"; els.calibBar.parentElement.classList.remove("done");
  els.calibDone.hidden = true;
  els.calibCount.hidden = false; els.calibCount.textContent = "3";
  els.countdown.hidden = false; els.countdown.textContent = "3";
  els.obCalib.disabled = true; els.obCalib.textContent = t("ob3.measuring"); els.btnCalib.disabled = true;
  setStatus(t("msg.calibStart"));
}
function finishCalib() {
  const values = {};
  for (const k of Object.keys(TARGETS)) values[k] = calib.sums[k] / calib.n;
  const geo = { gap: calib.geo.gap / calib.n, drop: calib.geo.drop / calib.n };
  const tex = calib.texN ? { energy: calib.tex.energy / calib.texN, vertical: calib.tex.vertical / calib.texN } : null;
  baseline = { at: Date.now(), values, geo, tex };
  saveJSON("fw.baseline", baseline);
  calib = null;
  resetStates();
  renderSettings();
  els.calibBar.style.width = "100%"; els.calibBar.parentElement.classList.add("done");
  els.calibCount.hidden = true; els.countdown.hidden = true;
  els.calibDone.hidden = false;
  els.calibDone.style.animation = "none"; void els.calibDone.offsetWidth; els.calibDone.style.animation = ""; // 完了の動きを毎回出す
  els.stage.classList.add("ok"); setTimeout(() => els.stage.classList.remove("ok"), 1200);
  els.obCalib.disabled = false; els.obCalib.textContent = t("ob3.retake"); els.btnCalib.disabled = false;
  els.obCalibNext.disabled = false;
  setStatus(t("msg.calibDone"));
  console.log("[fw] baseline", values);
}
function cancelCalib() {
  calib = null;
  els.calibBar.style.width = "0%";
  els.calibCount.hidden = true; els.countdown.hidden = true;
  els.obCalib.disabled = false; els.obCalib.textContent = t(baseline ? "ob3.retake" : "ob3.take"); els.btnCalib.disabled = false;
  setStatus(t("msg.calibFail"));
}

function processFrame(now) {
  const dt = lastTick == null ? 0 : (now - lastTick) / 1000;
  lastTick = now;
  let res;
  try { res = landmarker.detectForVideo(els.video, now); }
  catch (e) { console.warn("[fw] detect error", e); return; }
  const lm = res.faceLandmarks?.[0];
  const bs = res.faceBlendshapes?.[0];
  const day = todayStats();
  frameCount++;
  if (frameCount === 1 || frameCount % 100 === 0) console.log(`[fw] frame ${frameCount} faces=${lm ? 1 : 0}`);

  if (!lm || !bs) {
    day.noFaceSec += dt;
    diag.scores = null; diag.geo = null; diag.tex = null;
    for (const k of Object.keys(TARGETS)) { liveEff[k] = null; states[k].active = false; states[k].aboveSince = null; }
    setState("noface");
    drawOverlay(null); updateMeters(); updateAlertUI();
  } else {
    day.faceSec += dt;
    const scores = {};
    for (const c of bs.categories) scores[c.categoryName] = c.score;
    const v = name => scores[name] ?? 0;
    const geo = geoFeatures(lm, els.video.videoWidth, els.video.videoHeight);
    const tex = textureScore(lm, els.video.videoWidth, els.video.videoHeight);
    diag.scores = scores; diag.geo = geo; diag.tex = tex;
    for (const n of DIAG_BLEND) pushPeak(n, v(n), now);
    pushPeak("geo:gap", geo.gap, now); pushPeak("geo:drop", geo.drop, now);
    if (tex) { pushPeak("tex:energy", tex.energy, now); pushPeak("tex:vertical", tex.vertical, now); }
    if (calib) {
      calib.n++;
      for (const [k, tg] of Object.entries(TARGETS)) calib.sums[k] = (calib.sums[k] || 0) + tg.score(v);
      calib.geo.gap += geo.gap; calib.geo.drop += geo.drop;
      if (tex) { calib.texN++; calib.tex.energy += tex.energy; calib.tex.vertical += tex.vertical; }
    }
    for (const [k, tg] of Object.entries(TARGETS)) {
      const eff = Math.max(0, tg.score(v) - (baseline?.values?.[k] ?? 0));
      liveEff[k] = eff;
      const cfg = settings.targets[k];
      if (!cfg.on || calib) continue;
      const out = stepTarget(states[k], eff, now, dt, cfg);
      if (out.episodeStart) { day.targets[k].count++; console.log(`[fw] episode ${k}`); }
      if (out.activeSec) day.targets[k].sec += out.activeSec;
      if (out.alert) notify(k);
    }
    setState(calib ? "calib" : (tex && tex.luma < 50) ? "dark" : pipWindow ? "pip" : "on");
    drawOverlay(lm); updateMeters(); updateAlertUI();
  }

  if (calib) {
    const remain = calib.until - now;
    if (remain <= 0) { if (calib.n > 0) finishCalib(); else cancelCalib(); }
    else if (now - lastUi > 250) {
      const n = Math.ceil(remain / 1000);
      els.calibBar.style.width = `${(1 - remain / CALIB_MS) * 100}%`;
      els.calibCount.textContent = n; els.countdown.textContent = n;
      setStatus(t("msg.calibCountdown", { n }));
    }
  }
  if (now - lastUi > 250) { lastUi = now; updateLiveValues(); renderDiag(); }
  if (now - lastStatsRender > 2000) { lastStatsRender = now; saveStats(); renderStats(); }
}

function scheduleNext() {
  if (!running) return;
  const gen = ++loopGen;
  const tick = () => { if (gen === loopGen) loop(); };
  const host = pipWindow || window;
  if (host === window && document.visibilityState === "hidden") setTimeout(tick, 250);
  else host.requestAnimationFrame(tick);
}
function loop() {
  if (!running) return;
  const now = performance.now();
  if (now - lastProcess >= PROCESS_INTERVAL_MS && els.video.readyState >= 2 && els.video.videoWidth > 0) {
    lastProcess = now;
    processFrame(now);
  }
  scheduleNext();
}

// ---------- 開始・停止・小窓 ----------
async function createLandmarker() {
  const vision = await FilesetResolver.forVisionTasks(MP_WASM);
  const opts = delegate => ({
    baseOptions: { modelAssetPath: MODEL_URL, delegate },
    runningMode: "VIDEO", numFaces: 1, outputFaceBlendshapes: true, outputFacialTransformationMatrixes: false,
  });
  try { return await FaceLandmarker.createFromOptions(vision, opts("GPU")); }
  catch (e) { console.warn("[fw] GPU delegate failed, fallback to CPU", e); return await FaceLandmarker.createFromOptions(vision, opts("CPU")); }
}

function setButtons(mode) { // idle | loading | running
  currentMode = mode;
  els.btnStart.hidden = mode === "running";
  els.btnStart.disabled = mode === "loading";
  els.btnStart.textContent = t(mode === "loading" ? "btn.preparing" : "btn.start");
  els.btnPip.hidden = !(mode === "running" && pipSupported());
  els.btnStop.hidden = mode !== "running";
  els.btnStop.textContent = t("btn.stop");
  els.btnPip.textContent = t(pipWindow ? "btn.pipClose" : "btn.pip");
  setCameraButton(mode === "running", mode === "loading");
}

async function start() {
  if (running) return true;
  ensureAudio();
  setButtons("loading"); setState("loading");
  try {
    if (!landmarker) {
      setStatus(t("msg.modelLoading"));
      landmarker = await createLandmarker();
      console.log("[fw] model loaded");
    }
    setStatus(t("msg.cameraStarting"));
    stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: "user" }, audio: false });
    els.video.srcObject = stream;
    await els.video.play();
    console.log("[fw] camera started", els.video.videoWidth, els.video.videoHeight);
    running = true; lastTick = null; lastProcess = 0; frameCount = 0;
    resetStates();
    setButtons("running"); setState("on");
    setStatus(t(pipSupported() ? "msg.watchingPip" : "msg.watchingNoPip"));
    scheduleNext();
    return true;
  } catch (e) {
    console.error("[fw] start failed", e);
    setStatus(e?.name === "NotAllowedError" ? t("msg.cameraDenied") : t("msg.startFailed", { err: e?.message || e }));
    setButtons("idle"); setState("off");
    return false;
  }
}

function stop() {
  running = false; loopGen++;
  if (pipWindow) { try { pipWindow.close(); } catch {} }
  if (stream) { for (const tr of stream.getTracks()) tr.stop(); stream = null; }
  els.video.srcObject = null;
  calib = null; resetStates();
  for (const k of Object.keys(TARGETS)) liveEff[k] = null;
  diag.scores = null; diag.geo = null; diag.tex = null;
  updateMeters(); updateAlertUI(); updateLiveValues(); renderDiag(); drawOverlay(null);
  saveStats(); renderStats();
  setButtons("idle"); setState("off"); setStatus(t("msg.stopped"));
}

async function togglePip() {
  if (pipWindow) { pipWindow.close(); return; }
  try {
    const pip = await window.documentPictureInPicture.requestWindow({ width: 380, height: 300 });
    for (const sheet of document.styleSheets) {
      try {
        const css = [...sheet.cssRules].map(r => r.cssText).join("\n");
        const st = pip.document.createElement("style"); st.textContent = css; pip.document.head.appendChild(st);
      } catch {}
    }
    pip.document.title = "Frown Watch";
    pip.document.body.classList.add("pip");
    pip.document.body.append(els.stage);
    els.video.play().catch(() => {});
    pipWindow = pip;
    updatePlaceholder();
    setButtons("running"); if (running) setState("pip");
    setStatus(t("msg.pipOn"));
    pip.addEventListener("pagehide", () => {
      pipWindow = null;
      (currentHost || els.mainStageHost).append(els.stage);
      updatePlaceholder();
      els.video.play().catch(() => {});
      if (running) { setButtons("running"); setState("on"); setStatus(t("msg.pipClosed")); }
      scheduleNext();
    });
    scheduleNext();
  } catch (e) {
    console.error("[fw] pip failed", e);
    setStatus(t("msg.pipFailed", { err: e?.message || e }));
  }
}

// ---------- 動作環境チェック ----------
// 結果は鍵で持ち、描くときに翻訳する。言語を切り替えても描き直せるようにするため
async function checkEnvironment() {
  const ua = navigator.userAgent;
  let name = null, ver = 0, chromium = false;
  const brands = navigator.userAgentData?.brands || [];
  const b = brands.find(x => /Google Chrome|Microsoft Edge/.test(x.brand)) || brands.find(x => /Chromium/.test(x.brand));
  let m;
  if (b) { chromium = true; name = b.brand.replace("Google ", "").replace("Microsoft ", ""); ver = parseInt(b.version, 10) || 0; }
  else if ((m = ua.match(/Edg\/(\d+)/))) { chromium = true; name = "Edge"; ver = Number(m[1]); }
  else if ((m = ua.match(/Chrome\/(\d+)/))) { chromium = true; name = "Chrome"; ver = Number(m[1]); }
  else if ((m = ua.match(/Firefox\/(\d+)/))) { name = "Firefox"; ver = Number(m[1]); }
  else if ((m = ua.match(/Version\/(\d+).*Safari/))) { name = "Safari"; ver = Number(m[1]); }
  let cams = null;
  try { // 機器の列挙が返ってこない環境でも確認が止まらないよう、2 秒で諦める
    const devices = await Promise.race([navigator.mediaDevices.enumerateDevices(), new Promise(res => setTimeout(() => res(null), 2000))]);
    cams = devices ? devices.filter(d => d.kind === "videoinput").length : null;
  } catch { cams = null; }
  const items = [
    { key: "browser", ok: chromium && ver >= 116, required: true, detail: name ? `${name} ${ver || ""}`.trim() : { key: "env.unknown" },
      fix: chromium ? "env.fix.browserUpdate" : "env.fix.browserOther" },
    { key: "secure", ok: !!window.isSecureContext, required: true, detail: location.origin, fix: "env.fix.secure" },
    { key: "cameraApi", ok: !!navigator.mediaDevices?.getUserMedia, required: true, detail: "", fix: "env.fix.cameraApi" },
    { key: "cameraDevice", ok: cams == null ? true : cams > 0, required: true, detail: cams == null ? { key: "env.camsUnknown" } : { key: "env.cams", params: { n: cams } }, fix: "env.fix.cameraDevice" },
    { key: "pip", ok: pipSupported(), required: false, detail: "", fix: "env.fix.pip" },
    { key: "notification", ok: "Notification" in window, required: false, detail: "", fix: "env.fix.notification" },
    { key: "webgl", ok: !!document.createElement("canvas").getContext("webgl2"), required: false, detail: "", fix: "env.fix.webgl" },
  ];
  return { ok: items.every(i => i.ok || !i.required), items };
}
function renderEnv(container, r) {
  envResults.set(container, r);
  const label = i => t("env." + i.key);
  const detail = i => typeof i.detail === "string" ? i.detail : t(i.detail.key, i.detail.params);
  const sep = lang === "ja" ? "、" : ", ";
  const ng = r.items.filter(i => !i.ok && i.required), warn = r.items.filter(i => !i.ok && !i.required);
  const verdict = r.ok
    ? (warn.length ? t("env.okBut", { items: warn.map(label).join(sep) }) : t("env.ok"))
    : t("env.ng", { items: ng.map(label).join(sep) });
  container.hidden = false;
  container.innerHTML = `<div class="verdict ${r.ok ? "ok" : "ng"}">${r.ok ? "✓" : "✗"} ${verdict}</div><ul>` +
    r.items.map(i => `<li class="${i.ok ? "ok" : i.required ? "ng" : "warn"}"><span class="mark">${i.ok ? "✓" : "!"}</span><div><div>${label(i)}${detail(i) ? `<span class="detail">${detail(i)}</span>` : ""}</div>${i.ok ? "" : `<div class="fix">${t(i.fix)}</div>`}</div></li>`).join("") + `</ul>`;
}
async function runEnvCheck(btn, container) {
  btn.disabled = true; btn.textContent = t("env.checking");
  try { renderEnv(container, await checkEnvironment()); }
  finally { btn.disabled = false; btn.textContent = t("env.check"); }
}

// ---------- セットアップ ----------
function showOnboarding(step = 1) {
  els.onboarding.hidden = false; els.main.hidden = true;
  showStep(step);
}
function showMain() {
  els.onboarding.hidden = true; els.main.hidden = false;
  mountStage(els.mainStageHost);
  renderStats();
}
function showStep(n) {
  obStep = n;
  for (const s of els.onboarding.querySelectorAll(".step")) s.hidden = Number(s.dataset.step) !== n;
  for (const li of els.stepper.querySelectorAll("li")) {
    const k = Number(li.dataset.step);
    li.classList.toggle("current", k === n); li.classList.toggle("done", k < n);
  }
  if (n === 2) {
    mountStage(els.obStageHost);
    setCameraButton(running, currentMode === "loading");
    els.obCameraNext.disabled = !running;
    els.obCameraStatus.textContent = running ? t("msg.cameraRunning") : "";
  }
  if (n === 3) {
    mountStage(els.obCalibStageHost);
    els.obCalibNext.disabled = !baseline;
    els.calibBar.style.width = baseline ? "100%" : "0%";
    els.calibBar.parentElement.classList.toggle("done", !!baseline);
    els.calibDone.hidden = !baseline;
    els.calibCount.hidden = true;
    els.obCalib.textContent = t(calib ? "ob3.measuring" : baseline ? "ob3.retake" : "ob3.take");
    els.obCalibStatus.textContent = baseline ? t("msg.baselineExists") : "";
  }
  if (n === 5) {
    const ok = pipSupported();
    els.obPipNote.hidden = ok; els.obPip.hidden = !ok;
    if (!ok) els.obPipNote.textContent = t("ob5.nopip");
  }
  window.scrollTo({ top: 0 });
}
function finishOnboarding() {
  settings.onboarded = true; saveSettings();
  showMain();
}

// ---------- 言語 ----------
// 静的な文は data-i18n で、動的な部分は描画関数を呼び直して切り替える。再読み込みはしない
function applyLanguage(l) {
  lang = l; t = makeT(l); setLang(l);
  document.documentElement.lang = l;
  applyStatic(document, t);
  for (const b of els.lang.querySelectorAll("button")) b.classList.toggle("on", b.dataset.lang === l);
  els.version.textContent = t("footer.version", { v: APP_VERSION });
  buildTargetTable(); buildMeters(); buildFocusSelect(); renderSettings(); renderStats(); renderDiag(); updateAlertUI();
  setButtons(currentMode); setState(currentState); updatePlaceholder();
  if (!els.onboarding.hidden) showStep(obStep);
  for (const [container, r] of envResults) renderEnv(container, r);
}

// ---------- イベント ----------
for (const b of els.onboarding.querySelectorAll("[data-next]")) b.addEventListener("click", () => showStep(obStep + 1));
els.obCamera.addEventListener("click", async () => {
  mountStage(els.obStageHost);
  if (await start()) { setCameraButton(true); els.obCameraNext.disabled = false; els.obCameraStatus.textContent = t("msg.cameraOk"); }
});
els.obCalib.addEventListener("click", async () => {
  if (!running) { mountStage(els.obCalibStageHost); if (!(await start())) return; }
  startCalib();
});
els.obPip.addEventListener("click", () => { const p = togglePip(); finishOnboarding(); return p; });
els.obFinish.addEventListener("click", async () => { finishOnboarding(); if (!running) await start(); });

els.btnStart.addEventListener("click", () => { mountStage(els.mainStageHost); start(); });
els.btnStop.addEventListener("click", stop);
els.btnPip.addEventListener("click", togglePip);
els.btnCalib.addEventListener("click", async () => {
  if (!running) { mountStage(els.mainStageHost); if (!(await start())) return; }
  startCalib();
});
els.btnOnboarding.addEventListener("click", () => { settings.onboarded = false; saveSettings(); showOnboarding(1); });
els.envCheckBtn.addEventListener("click", () => runEnvCheck(els.envCheckBtn, els.envResult));
els.envCheckBtn2.addEventListener("click", () => runEnvCheck(els.envCheckBtn2, els.envResult2));
els.linkPrivacy.addEventListener("click", () => { els.privacy.open = true; });
els.linkEnv.addEventListener("click", () => { els.privacy.open = true; runEnvCheck(els.envCheckBtn2, els.envResult2); });
els.lang.addEventListener("click", e => { const b = e.target.closest("button"); if (b && LANGS.includes(b.dataset.lang)) applyLanguage(b.dataset.lang); });

for (const b of all(".btnTest")) b.addEventListener("click", () => {
  ensureAudio();
  flashStage(t("alert.test"));
  if (!settings.sound && !settings.notify) setStatus(t("msg.testOff"));
  else { states.glabella.lastAlertAt = -Infinity; notify("glabella"); }
});
for (const el of all(".optSound")) el.addEventListener("change", () => {
  settings.sound = el.checked; if (settings.sound) ensureAudio(); saveSettings(); renderSettings();
});
for (const el of all(".optNotify")) el.addEventListener("change", async () => {
  if (el.checked) {
    if (!("Notification" in window)) { setStatus(t("msg.noNotification")); el.checked = false; }
    else if (await Notification.requestPermission() !== "granted") { setStatus(t("msg.notifyDenied")); el.checked = false; }
  }
  settings.notify = el.checked; saveSettings(); renderSettings();
});
els.btnCsv.addEventListener("click", async () => {
  const keys = Object.keys(TARGETS);
  const head = ["date", ...keys.flatMap(k => [`${k}_count`, `${k}_sec`]), "face_sec", "noface_sec"];
  const rows = Object.keys(stats).sort().map(dk => {
    const s = stats[dk];
    return [dk, ...keys.flatMap(k => [s.targets[k].count, Math.round(s.targets[k].sec)]), Math.round(s.faceSec), Math.round(s.noFaceSec)].join(",");
  });
  const csv = [head.join(","), ...rows].join("\n");
  try { await navigator.clipboard.writeText(csv); setStatus(t("msg.csvCopied", { n: rows.length })); }
  catch { setStatus(t("msg.csvFailed")); console.log(csv); }
});
els.btnReset.addEventListener("click", () => {
  if (!confirm(t("confirm.reset"))) return;
  delete stats[dateKey()]; saveStats(); renderStats(); updateAlertUI();
});
els.video.addEventListener("loadedmetadata", () => {
  if (els.video.videoWidth && els.video.videoHeight) els.stage.style.aspectRatio = `${els.video.videoWidth} / ${els.video.videoHeight}`;
});
window.addEventListener("beforeunload", saveStats);

// ---------- 初期化 ----------
if (settings.notify && !("Notification" in window && Notification.permission === "granted")) settings.notify = false;
applyLanguage(lang);
checkEnvironment().then(r => { if (!r.ok) renderEnv(els.envResult, r); }); // 足りないものがあれば最初から見せる
const params = new URLSearchParams(location.search);
if (params.has("open")) for (const d of document.querySelectorAll("details")) d.open = true;
if (params.has("env")) runEnvCheck(els.envCheckBtn, els.envResult);
if (params.has("ob")) showOnboarding(Number(params.get("ob")) || 1);
else if (params.has("autostart")) { showMain(); start(); }
else if (settings.onboarded) showMain();
else showOnboarding(1);
if (location.hash === "#privacy") { els.privacy.open = true; els.privacy.scrollIntoView(); }
