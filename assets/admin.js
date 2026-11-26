/* 서울 출사 지도 — 관리 페이지
   - GitHub 저장소(공개)의 data/places.json · data/photos.json · photos/ 를 GitHub API로 직접 고침
   - 개인 메모는 비공개 저장소(notes.json)에만 저장
   - 토큰은 이 브라우저(localStorage)에만 저장. 사이트·저장소에는 절대 쓰지 않음
   - 사진: 방향 보정 → 긴 변 1400px → 워터마크 → WebP(약 200KB 목표) + 목록용 480px. 메타데이터(GPS 등)는 다시 그리면서 모두 빠짐. 원본은 올리지 않음 */
"use strict";
const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const clone = o => JSON.parse(JSON.stringify(o));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const kb = n => n >= 1048576 ? (n / 1048576).toFixed(1) + "MB" : Math.round(n / 1024) + "KB";

/* ---------- 상수 (방문자 페이지와 같은 항목) ---------- */
const SEASONS = ["봄", "여름", "가을", "겨울"];
const THEMES = ["벚꽃", "단풍", "야경", "일몰", "도시·건축", "골목", "자연", "한강", "인물"];
const TIMES = ["", "새벽", "오전", "한낮", "오후", "일몰·매직아워", "블루아워", "야간"];
const LINE_CODES = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "SB", "SS", "GJ", "AR", "GC", "UI", "SL", "GA"];
const VISIT_FIELDS = [["notes.hours", "운영시간"], ["notes.closed", "휴무일"], ["notes.fee", "입장료"], ["notes.reserve", "예약"], ["notes.entrance", "출입구·접근"], ["notes.walk", "도보 참고"], ["notes.tripod", "삼각대"], ["notes.restrict", "촬영 제한"], ["notes.caution", "주의사항"]];
const SHOOT_FIELDS = [["highlights", "소재·포인트"], ["composition", "추천 구도"], ["focal", "초점거리"], ["bestTime", "추천 시간대"], ["seasonIdeas", "계절 아이디어"], ["night", "야경 아이디어"], ["care", "혼잡·안전·사생활"], ["position", "위치·방향 참고"]];
const LIST_KEYS = new Set(["highlights", "seasons", "themes", "tags", "access"]);
const EDIT_KEYS = ["name", "address", "tags", "lat", "lng", "intro", "access", "official", ...VISIT_FIELDS.map(x => x[0]), "nightFact", ...SHOOT_FIELDS.map(x => x[0]), "seasons", "themes", "markerTheme"];
const KIND_CODE = { fact: "f", ref: "r", suggest: "s", unknown: "u" };
const WM_TEXT = "© youngphoto0204";
const WM_POS = [["br", "오른쪽 아래"], ["bl", "왼쪽 아래"], ["bc", "아래 가운데"], ["tr", "오른쪽 위"], ["tl", "왼쪽 위"]];
const FULL_EDGE = 1400, THUMB_EDGE = 480, TARGET_BYTES = 200 * 1024;
const LIMIT_BYTES = 1024 ** 3, WARN_RATIO = 0.8;

/* ---------- 설정·토큰 (이 브라우저에만) ---------- */
const CFG_KEY = "spm-admin-cfg", TOKEN_KEY = "spm-admin-token";
function detectPrefix() {
  // https://youngphoto0204.github.io/seoul-photo-map/beta/admin.html → "beta/"
  if (!/\.github\.io$/.test(location.hostname)) return "";
  const parts = location.pathname.split("/").filter(Boolean);
  if (parts.length && /\.html?$/.test(parts[parts.length - 1])) parts.pop();
  return parts.slice(1).map(p => p + "/").join("");
}
const DEFAULT_CFG = { owner: "youngphoto0204", repo: "seoul-photo-map", branch: "main", prefix: detectPrefix(), notesRepo: "seoul-photo-map-notes" };
function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
function lsSet(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); return true; } catch (e) { return false; } }
let cfg = (() => { try { return { ...DEFAULT_CFG, ...JSON.parse(lsGet(CFG_KEY) || "{}") }; } catch (e) { return { ...DEFAULT_CFG }; } })();
let token = lsGet(TOKEN_KEY) || "";
const R = () => `/repos/${cfg.owner}/${cfg.repo}`;
const NR = () => `/repos/${cfg.owner}/${cfg.notesRepo}`;

/* ---------- 상태 ---------- */
const A = {
  P: null, F: null, N: null, notesState: "unknown", repo: null, sizeKB: 0,
  sel: null, tab: "photos", q: "", onlyPhotos: false,
  queue: [], pw: null, pnotes: {}, local: new Map(), busy: false,
};

/* ---------- 오류: 예상한 오류(UserError)는 안내 띠, 그 밖은 오류 화면 ---------- */
class UserError extends Error { constructor(m, status) { super(m); this.user = true; this.status = status; } }
function banner(html, kind) { const b = $("#banner"); if (!html) { b.hidden = true; return; } b.className = "adm-banner" + (kind === "ok" ? " ok" : ""); b.innerHTML = html + ` <button type="button" class="btn small ghost" data-act="banner-x">닫기</button>`; b.hidden = false; }
let toastT;
function toast(msg, err) { const el = $("#toast"); el.className = "toast" + (err ? " err" : ""); el.innerHTML = `<span>${esc(msg)}</span>`; el.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => el.hidden = true, err ? 7000 : 3200); }

/* ---------- 잠금: 처리 중에는 화면 전체를 막아 두 번 누르기를 방지 ---------- */
function progress(msg, frac) { $("#busyMsg").textContent = msg || ""; $("#busyBar").style.width = frac == null ? "0" : Math.round(Math.max(0, Math.min(1, frac)) * 100) + "%"; }
const beforeUnload = e => { e.preventDefault(); e.returnValue = ""; };
async function withLock(title, fn) {
  if (A.busy) return;
  A.busy = true; document.querySelectorAll("[data-lock]").forEach(b => b.disabled = true);
  $("#busyT").textContent = title; progress(""); $("#busy").hidden = false;
  addEventListener("beforeunload", beforeUnload);
  try { return await fn(progress); }
  catch (e) {
    console.error(e);
    if (e && e.user) { banner(`<b>${esc(title)} 실패.</b> ${esc(e.message)}`); toast(e.message, true); }
    else window.__spmFatal?.((e && (e.stack || e.message)) || String(e));
  } finally {
    A.busy = false; $("#busy").hidden = true; document.querySelectorAll("[data-lock]").forEach(b => b.disabled = false);
    removeEventListener("beforeunload", beforeUnload);
  }
}

/* =====================================================================
   GitHub API
   ===================================================================== */
const API = "https://api.github.com";
function ghMessage(status, text) {
  let m = ""; try { m = JSON.parse(text).message || ""; } catch (e) { m = text.slice(0, 120); }
  if (status === 401) return "토큰이 맞지 않거나 만료됐어요. ‘설정’에서 토큰을 다시 입력해 주세요.";
  if (status === 403) return `권한이 없어요. 토큰의 저장소 선택과 ‘Contents: Read and write’ 권한을 확인해 주세요. (${m})`;
  if (status === 404) return "저장소나 파일을 찾지 못했어요. 저장소 이름과 토큰의 저장소 선택을 확인해 주세요.";
  if (status === 409) return "저장소가 비어 있거나 다른 곳에서 동시에 바뀌었어요. 잠시 뒤 다시 시도해 주세요.";
  return `GitHub 오류 (HTTP ${status}${m ? ": " + m : ""})`;
}
async function gh(method, path, body, opt = {}) {
  for (let attempt = 0; ; attempt++) {
    let r;
    try {
      r = await fetch(API + path, {
        method, cache: "no-store",
        headers: { Authorization: `Bearer ${opt.token || token}`, Accept: opt.accept || "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", ...(body ? { "Content-Type": "application/json" } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (e) {
      if (attempt < 2) { await sleep(1500 * (attempt + 1)); continue; }
      throw new UserError("GitHub에 연결하지 못했어요. 인터넷 연결을 확인한 뒤 다시 시도해 주세요.");
    }
    if (r.status === 404 && opt.allow404) return null;
    if (r.ok) { if (opt.raw) return await r.text(); if (r.status === 204) return null; return await r.json(); }
    const text = await r.text();
    // 요청 한도: 기다렸다가 다시 시도 (사진을 많이 올릴 때)
    const limited = r.status === 429 || (r.status === 403 && (/rate limit/i.test(text) || r.headers.get("x-ratelimit-remaining") === "0"));
    if (limited && attempt < 6) {
      const ra = +r.headers.get("retry-after") || 0, reset = +r.headers.get("x-ratelimit-reset") || 0;
      let wait = ra ? ra : reset ? Math.max(5, reset - Date.now() / 1000) : 60;
      wait = Math.min(wait, 15 * 60);
      for (let s = Math.ceil(wait); s > 0; s--) { $("#busyMsg").textContent = `GitHub 요청 한도 때문에 잠시 기다리는 중… ${s}초`; await sleep(1000); }
      continue;
    }
    if (r.status >= 500 && attempt < 2) { await sleep(2000); continue; }
    throw new UserError(ghMessage(r.status, text), r.status);
  }
}
const encPath = p => p.split("/").map(encodeURIComponent).join("/");
async function getRaw(path, ref, repoPath = R(), allow404 = true) {
  return gh("GET", `${repoPath}/contents/${encPath(path)}?ref=${encodeURIComponent(ref)}`, null, { accept: "application/vnd.github.raw+json", raw: true, allow404 });
}
function b64utf8(s) { const b = new TextEncoder().encode(s); let out = ""; for (let i = 0; i < b.length; i += 0x8000) out += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000)); return btoa(out); }
function unb64utf8(s) { const bin = atob(s.replace(/\n/g, "")); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return new TextDecoder().decode(u); }
async function blobB64(blob) { const buf = new Uint8Array(await blob.arrayBuffer()); let out = ""; for (let i = 0; i < buf.length; i += 0x8000) out += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000)); return btoa(out); }
async function createBlob(blob) { const r = await gh("POST", `${R()}/git/blobs`, { content: await blobB64(blob), encoding: "base64" }); return r.sha; }

/* 공개 데이터 파일: 한 줄에 장소(사진) 하나씩 — GitHub에서 바뀐 곳을 보기 쉬움 */
function fmtList(obj, key) {
  const head = { ...obj }; delete head[key];
  let s = JSON.stringify(head); s = s.slice(0, -1) + (s.length > 2 ? "," : "") + JSON.stringify(key) + ":[\n" + (obj[key] || []).map(x => JSON.stringify(x)).join(",\n") + "\n]}\n";
  return s;
}
const EMPTY_PHOTOS = () => ({ schema: "seoul-photo-map/photos/1", updatedAt: null, photos: [] });
async function readMain(ref) {
  const [pt, ft] = await Promise.all([getRaw(cfg.prefix + "data/places.json", ref), getRaw(cfg.prefix + "data/photos.json", ref)]);
  if (pt == null) throw new UserError(`저장소에 ${cfg.prefix}data/places.json이 없어요. 새 버전 파일을 먼저 올렸는지, ‘설정’의 폴더(접두어)가 맞는지 확인해 주세요.`);
  let P, F;
  try { P = JSON.parse(pt); F = ft ? JSON.parse(ft) : EMPTY_PHOTOS(); } catch (e) { throw new UserError("데이터 파일(JSON)을 읽지 못했어요. 파일이 손상됐을 수 있어요."); }
  P.places = P.places || []; P.sources = P.sources || {}; F.photos = F.photos || [];
  return { P, F };
}
/* 한 번의 커밋으로 사진 파일 여러 개 + 데이터 파일을 함께 반영.
   mutate는 매번 저장소의 최신 데이터에 다시 적용하므로, 다른 기기에서 먼저 바꿨어도 덮어쓰지 않음 */
async function commitMain({ message, blobs = [], deletes = [], mutate }) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const ref = await gh("GET", `${R()}/git/ref/heads/${encodeURIComponent(cfg.branch)}`);
    const head = ref.object.sha;
    const c = await gh("GET", `${R()}/git/commits/${head}`);
    const { P, F } = await readMain(head);
    const p0 = JSON.stringify(P), f0 = JSON.stringify(F);
    const extra = mutate ? (mutate(P, F) || {}) : {};
    const dels = [...deletes, ...(extra.deletes || [])];
    const tree = [
      ...blobs.map(b => ({ path: cfg.prefix + b.path, mode: "100644", type: "blob", sha: b.sha })),
      ...[...new Set(dels)].map(p => ({ path: cfg.prefix + p, mode: "100644", type: "blob", sha: null })),
    ];
    const now = new Date().toISOString();
    if (JSON.stringify(P) !== p0) { P.updatedAt = now; tree.push({ path: cfg.prefix + "data/places.json", mode: "100644", type: "blob", content: fmtList(P, "places") }); }
    if (JSON.stringify(F) !== f0) { F.updatedAt = now; tree.push({ path: cfg.prefix + "data/photos.json", mode: "100644", type: "blob", content: fmtList(F, "photos") }); }
    if (!tree.length) { A.P = P; A.F = F; return null; }
    const t = await gh("POST", `${R()}/git/trees`, { base_tree: c.tree.sha, tree });
    const nc = await gh("POST", `${R()}/git/commits`, { message, tree: t.sha, parents: [head] });
    try { await gh("PATCH", `${R()}/git/refs/heads/${encodeURIComponent(cfg.branch)}`, { sha: nc.sha, force: false }); }
    catch (e) { if (e.status === 422 && attempt < 3) { await sleep(800); continue; } throw e; }
    A.P = P; A.F = F; A.sizeKB += Math.round(blobs.reduce((s, b) => s + (b.size || 0), 0) / 1024); renderMeter();
    return nc.sha;
  }
  throw new UserError("다른 곳에서 저장소가 계속 바뀌고 있어 반영하지 못했어요. 잠시 뒤 다시 시도해 주세요.");
}

/* ---------- 비공개 메모 (notes 저장소의 notes.json) ---------- */
const EMPTY_NOTES = () => ({ schema: "seoul-photo-map/notes/1", updatedAt: null, places: {}, photos: {} });
async function readNotes() {
  const j = await gh("GET", `${NR()}/contents/notes.json`, null, { allow404: true });
  if (!j) return { N: null, sha: null };
  let text = j.content && j.encoding === "base64" ? unb64utf8(j.content) : await gh("GET", `${NR()}/contents/notes.json`, null, { accept: "application/vnd.github.raw+json", raw: true });
  let N; try { N = JSON.parse(text); } catch (e) { throw new UserError("비공개 메모 파일(notes.json)을 읽지 못했어요."); }
  N.places = N.places || {}; N.photos = N.photos || {};
  return { N, sha: j.sha };
}
async function saveNotes(mutate, message) {
  if (A.notesState === "norepo") throw new UserError(`비공개 저장소(${cfg.notesRepo})에 접근할 수 없어 메모를 저장하지 못했어요. 저장소를 만들고 토큰에 추가해 주세요.`);
  for (let attempt = 0; attempt < 4; attempt++) {
    const { N: cur, sha } = await readNotes();
    const N = cur || EMPTY_NOTES();
    mutate(N); N.updatedAt = new Date().toISOString();
    try {
      await gh("PUT", `${NR()}/contents/notes.json`, { message, content: b64utf8(JSON.stringify(N, null, 1) + "\n"), ...(sha ? { sha } : {}) });
      A.N = N; A.notesState = "ok"; return;
    } catch (e) { if ((e.status === 409 || e.status === 422) && attempt < 3) { await sleep(800); continue; } throw e; }
  }
}
const noteOf = id => (A.N?.places?.[id]) || {};

/* =====================================================================
   데이터 보기 도우미 — 방문자 페이지의 층 구조(src → res → man)와 같음
   ===================================================================== */
function districtFromAddr(a) { const m = String(a || "").match(/^서울(?:특별시|시)?\s+(\S+구)(?=\s|$)/); return m ? m[1] : null; }
function baseVal(rec, k) {
  const s = rec.src || {};
  if (k === "name") return s.name || "";
  if (k === "address") return s.address || "";
  if (k === "lat" || k === "lng") return s[k] ?? null;
  if (k === "tags") return Array.isArray(s.tags) ? s.tags.slice() : [];
  const e = rec.res?.[k];
  if (!e || e[0] === "u") return LIST_KEYS.has(k) ? [] : null;
  return clone(e[1]);
}
const val = (rec, k) => rec.man && Object.prototype.hasOwnProperty.call(rec.man, k) ? rec.man[k] : baseVal(rec, k);
const isEmptyV = v => v == null || (Array.isArray(v) ? !v.length : String(v).trim() === "");
const canon = v => JSON.stringify(v ?? null, (k, x) => x === "" ? null : x);
const sameV = (a, b) => (isEmptyV(a) && isEmptyV(b)) || canon(a) === canon(b);
const recOf = id => A.P?.places.find(r => r.id === id) || null;
const nameOf = rec => val(rec, "name") || "(이름 없음)";
const photosOf = id => (A.F?.photos || []).filter(x => x.placeId === id).sort((a, b) => (a.order || 0) - (b.order || 0));
function photoUrl(path) {
  if (A.local.has(path)) return A.local.get(path);
  // Pages 반영 전에도 바로 보이도록 저장소 원본 주소를 씀 (공개 저장소)
  return `https://raw.githubusercontent.com/${cfg.owner}/${cfg.repo}/${encodeURIComponent(cfg.branch)}/${encPath(cfg.prefix + path)}`;
}

/* =====================================================================
   사진 처리 — 브라우저 안에서만. 원본 파일은 어디에도 올리지 않음
   ===================================================================== */
async function readExifDate(file) {
  try {
    if (!/jpe?g/i.test(file.type) && !/\.jpe?g$/i.test(file.name || "")) return null;
    const v = new DataView(await file.slice(0, 262144).arrayBuffer());
    if (v.getUint16(0) !== 0xFFD8) return null;
    let o = 2;
    while (o + 10 < v.byteLength) {
      const m = v.getUint16(o); if ((m & 0xFF00) !== 0xFF00) break;
      const len = v.getUint16(o + 2);
      if (m === 0xFFE1 && v.getUint32(o + 4) === 0x45786966) {
        const t = o + 10, le = v.getUint16(t) === 0x4949, g16 = p => v.getUint16(p, le), g32 = p => v.getUint32(p, le);
        const ifd = p => { const n = g16(p), out = {}; for (let i = 0; i < n; i++) { const e = p + 2 + i * 12; out[g16(e)] = { count: g32(e + 4), vo: e + 8 }; } return out; };
        const str = en => { const off = en.count > 4 ? t + g32(en.vo) : en.vo; let s = ""; for (let i = 0; i < en.count - 1; i++) s += String.fromCharCode(v.getUint8(off + i)); return s; };
        const i0 = ifd(t + g32(t + 4)); let d = null;
        if (i0[0x8769]) { const ex = ifd(t + g32(i0[0x8769].vo)); const de = ex[0x9003] || ex[0x9004]; if (de) d = str(de); }
        if (!d && i0[0x0132]) d = str(i0[0x0132]);
        const mm = (d || "").match(/^(\d{4}):(\d{2}):(\d{2})/);
        return mm ? `${mm[1]}-${mm[2]}-${mm[3]}` : null; // 날짜만 씀. 위치(GPS)는 읽지도 저장하지도 않음
      }
      o += 2 + len;
    }
  } catch (e) { }
  return null;
}
const isHeic = f => /image\/hei[cf]/i.test(f.type || "") || /\.(heic|heif)$/i.test(f.name || "");
async function decodeImage(blob) {
  try { return await createImageBitmap(blob, { imageOrientation: "from-image" }); } catch (e) { }
  const u = URL.createObjectURL(blob);
  try { const im = new Image(); im.decoding = "async"; im.src = u; await im.decode(); return im; } // <img>는 EXIF 방향을 반영함
  catch (e) { throw new UserError("이 브라우저가 열 수 없는 사진 형식이에요. JPG나 PNG로 바꿔서 올려 주세요."); }
  finally { setTimeout(() => URL.revokeObjectURL(u), 1000); }
}
function drawScaled(src, maxEdge) {
  const w0 = src.width || src.naturalWidth, h0 = src.height || src.naturalHeight;
  const s = Math.min(1, maxEdge / Math.max(w0, h0)), W = Math.max(1, Math.round(w0 * s)), Hh = Math.max(1, Math.round(h0 * s));
  // 크게 줄일 때는 절반씩 나눠 줄여 계단 현상을 줄임
  let cur = src, cw = w0, ch = h0;
  while (cw / 2 > W * 1.05) {
    const c = document.createElement("canvas"); c.width = Math.round(cw / 2); c.height = Math.round(ch / 2);
    const x = c.getContext("2d"); x.imageSmoothingQuality = "high"; x.drawImage(cur, 0, 0, c.width, c.height);
    cur = c; cw = c.width; ch = c.height;
  }
  const c = document.createElement("canvas"); c.width = W; c.height = Hh;
  const x = c.getContext("2d"); x.fillStyle = "#ffffff"; x.fillRect(0, 0, W, Hh); x.imageSmoothingQuality = "high"; x.drawImage(cur, 0, 0, W, Hh);
  return c;
}
function drawWatermark(c, pos) {
  const x = c.getContext("2d"), W = c.width, H = c.height;
  const fs = Math.max(10, Math.round(Math.max(W, H) * 0.02)), m = Math.round(fs * 0.9);
  x.save();
  x.font = `600 ${fs}px "IBM Plex Sans KR", -apple-system, "Helvetica Neue", Arial, sans-serif`;
  x.textBaseline = pos[0] === "t" ? "top" : "bottom";
  x.textAlign = pos[1] === "l" ? "left" : pos[1] === "c" ? "center" : "right";
  const tx = pos[1] === "l" ? m : pos[1] === "c" ? W / 2 : W - m, ty = pos[0] === "t" ? m : H - m;
  x.shadowColor = "rgba(0,0,0,.45)"; x.shadowBlur = Math.max(2, fs * 0.25); x.shadowOffsetY = Math.max(1, fs * 0.04);
  x.fillStyle = "rgba(255,255,255,.62)";
  x.fillText(WM_TEXT, tx, ty);
  x.restore();
}
/* WebP 만들기: 브라우저가 지원하면 그대로, 아니면(사파리 등) 함께 넣은 변환 도구(WASM)로 */
let nativeWebp = null, wasmEnc = null;
async function hasNativeWebp() {
  if (nativeWebp !== null) return nativeWebp;
  const c = document.createElement("canvas"); c.width = c.height = 4;
  const b = await new Promise(r => c.toBlob(r, "image/webp", 0.8));
  return (nativeWebp = !!b && b.type === "image/webp");
}
const WASM_OPTS = { quality: 75, target_size: 0, target_PSNR: 0, method: 4, sns_strength: 50, filter_strength: 60, filter_sharpness: 0, filter_type: 1, partitions: 0, segments: 4, pass: 1, show_compressed: 0, preprocessing: 0, autofilter: 0, partition_limit: 0, alpha_compression: 1, alpha_filtering: 1, alpha_quality: 100, lossless: 0, exact: 0, image_hint: 0, emulate_jpeg_size: 0, thread_level: 0, low_memory: 0, near_lossless: 100, use_delta_palette: 0, use_sharp_yuv: 0 };
async function encodeWebp(c, q) {
  if (await hasNativeWebp() && !window.__spmForceWasm) {
    const b = await new Promise(r => c.toBlob(r, "image/webp", q));
    if (b && b.type === "image/webp") return b;
  }
  if (!wasmEnc) {
    try { const mod = await import("./vendor/webp/webp_enc.js"); wasmEnc = await mod.default({ noInitialRun: true }); }
    catch (e) { console.error(e); throw new UserError("WebP 변환 도구를 불러오지 못했어요. 새로고침한 뒤 다시 시도해 주세요."); }
  }
  const d = c.getContext("2d").getImageData(0, 0, c.width, c.height);
  const out = wasmEnc.encode(d.data, c.width, c.height, { ...WASM_OPTS, quality: Math.round(q * 100) });
  if (!out) throw new UserError("WebP 변환에 실패했어요.");
  return new Blob([out], { type: "image/webp" });
}
/* 목표 용량(약 200KB) 안에서 가장 높은 화질을 찾음 */
async function encodeTarget(c) {
  const steps = (await hasNativeWebp() && !window.__spmForceWasm) ? 4 : 3;
  let lo = 0.3, hi = 0.9, best = null;
  let b = await encodeWebp(c, 0.82);
  if (b.size <= TARGET_BYTES) { best = { b, q: 0.82 }; lo = 0.82; } else hi = 0.82;
  for (let i = 0; i < steps; i++) {
    const mid = Math.round((lo + hi) / 2 * 100) / 100; if (best && Math.abs(mid - best.q) < 0.015) break;
    b = await encodeWebp(c, mid);
    if (b.size <= TARGET_BYTES) { best = { b, q: mid }; lo = mid; } else hi = mid;
  }
  if (!best) { b = await encodeWebp(c, 0.3); best = { b, q: 0.3 }; }
  return best;
}
async function processPhoto(src, wm) {
  const bmp = await decodeImage(src);
  try {
    const full = drawScaled(bmp, FULL_EDGE); drawWatermark(full, wm);
    const thumb = drawScaled(bmp, THUMB_EDGE); drawWatermark(thumb, wm);
    const f = await encodeTarget(full), t = await encodeWebp(thumb, 0.72);
    return { full: f.b, q: f.q, thumb: t, w: full.width, h: full.height, tw: thumb.width, th: thumb.height };
  } finally { bmp.close?.(); }
}
const safeId = s => String(s).replace(/[^\w-]/g, "").slice(0, 40) || "ph" + uid();
function pathsFor(placeId, id) { const d = `photos/${safeId(placeId)}/`; return { full: d + id + ".webp", thumb: d + id + "-t.webp" }; }

/* =====================================================================
   화면
   ===================================================================== */
function renderMeter() {
  const el = $("#meter"); if (!A.repo) { el.hidden = true; return; }
  const bytes = A.sizeKB * 1024, r = bytes / LIMIT_BYTES;
  el.hidden = false; el.classList.toggle("warn", r >= WARN_RATIO);
  $("#meterBar").style.width = Math.min(100, Math.max(1, r * 100)).toFixed(1) + "%";
  $("#meterText").textContent = `저장소 약 ${kb(bytes)} / 1GB (${(r * 100).toFixed(r < 0.1 ? 1 : 0)}%)`;
  el.title = "GitHub가 알려 주는 저장소 크기예요(반영이 조금 늦을 수 있어요). 1GB를 넘기지 않는 것이 권장돼요.";
  if (r >= WARN_RATIO) banner(`<b>저장소 용량이 1GB의 ${Math.round(r * 100)}%예요.</b> 1GB에 가까워지면 사진 전용 저장소를 하나 더 만들어 나눠 담아야 해요. 그 전에 저에게(Claude) 말해 주세요.`);
}
function renderList() {
  if (!A.P) return;
  const q = A.q.trim().toLowerCase();
  const cnt = new Map(); for (const x of A.F.photos) cnt.set(x.placeId, (cnt.get(x.placeId) || 0) + 1);
  const list = A.P.places.filter(r => (!q || (nameOf(r) + " " + val(r, "address")).toLowerCase().includes(q)) && (!A.onlyPhotos || cnt.get(r.id)));
  $("#placeCount").textContent = `${list.length}곳`;
  $("#plist").innerHTML = list.map(r => `<li><button type="button" data-pid="${esc(r.id)}" aria-current="${A.sel === r.id}"><span class="nm">${esc(nameOf(r))}</span>${r.public === false ? `<span class="off">숨김</span>` : ""}<span class="ct">${cnt.get(r.id) ? "사진 " + cnt.get(r.id) : ""}</span></button></li>`).join("") || `<li class="fine" style="padding:10px">없어요</li>`;
}
function selectPlace(id) {
  if (A.sel !== id && A.queue.some(q => q.status !== "done")) { if (!confirm("올리지 않은 사진이 있어요. 다른 장소로 옮기면 목록에서 사라져요. 옮길까요?")) return; }
  A.sel = id; A.queue.forEach(q => q.url && URL.revokeObjectURL(q.url)); A.queue = []; A.pw = null; A.pnotes = {};
  document.body.classList.toggle("has-sel", !!id);
  renderList(); renderWork(); scrollTo({ top: 0 });
}
function renderWork() {
  const w = $("#work"), rec = A.sel && recOf(A.sel);
  if (!rec) { w.innerHTML = `<div class="adm-empty">왼쪽에서 장소를 고르세요.<br><span class="fine">사진 올리기 · 장소 정보 고치기 · 개인 메모를 장소별로 해요.</span></div>`; return; }
  const n = photosOf(rec.id).length;
  w.innerHTML = `
    <div class="adm-ph"><div><button type="button" class="btn small ghost onlym-adm" data-act="back">← 목록</button>
      <h2>${esc(nameOf(rec))}</h2><div class="sub">${esc(val(rec, "address") || "주소 없음")} · <span class="mono">${esc(rec.id)}</span>${rec.public === false ? ` · <b style="color:var(--danger)">사이트에서 숨김</b>` : ""}</div></div></div>
    <div class="adm-tabs" role="tablist">
      ${[["photos", `사진 ${n}`], ["info", "장소 정보"], ["notes", "개인 메모"]].map(([k, l]) => `<button type="button" role="tab" data-tab="${k}" aria-selected="${A.tab === k}">${l}</button>`).join("")}
    </div>
    <div id="tabBody"></div>`;
  ({ photos: tabPhotos, info: tabInfo, notes: tabNotes })[A.tab]();
}

/* ---------- 사진 탭 ---------- */
function ensurePw() {
  if (A.pw) return;
  A.pw = photosOf(A.sel).map(x => ({ ...x, _del: false }));
  A.pnotes = {}; for (const x of A.pw) A.pnotes[x.id] = A.N?.photos?.[x.id]?.note || "";
}
function pwDirty() {
  if (!A.pw) return false;
  const orig = new Map(photosOf(A.sel).map(x => [x.id, x]));
  return A.pw.some(x => x._del || ["caption", "takenAt", "season", "time", "shot", "order", "cover"].some(k => (x[k] || "") !== (orig.get(x.id)?.[k] || ""))) ||
    A.pw.some(x => (A.pnotes[x.id] || "") !== (A.N?.photos?.[x.id]?.note || ""));
}
function fieldsHTML(o, key, note) {
  return `<label>캡션<input data-f="caption" data-k="${key}" value="${esc(o.caption)}" placeholder="사이트에 보이는 설명"></label>
    <div class="grid2"><label>촬영일<input data-f="takenAt" data-k="${key}" value="${esc(o.takenAt)}" placeholder="2026-11-03"></label>
      <label>계절<select data-f="season" data-k="${key}"><option value=""></option>${SEASONS.map(s => `<option ${o.season === s ? "selected" : ""}>${s}</option>`).join("")}</select></label></div>
    <div class="grid2"><label>시간대<select data-f="time" data-k="${key}">${TIMES.map(s => `<option value="${s}" ${o.time === s ? "selected" : ""}>${s || ""}</option>`).join("")}</select></label>
      <label>촬영 설정<input data-f="shot" data-k="${key}" value="${esc(o.shot)}" placeholder="35mm f/8 1/250"></label></div>
    <label>개인 메모 (비공개)<input data-f="note" data-k="${key}" value="${esc(note)}" placeholder="다음 출사 때 참고"></label>`;
}
function wmHTML(key, cur) { return `<div class="wm" role="group" aria-label="워터마크 위치">워터마크 ${WM_POS.map(([k, l]) => `<button type="button" data-wm="${k}" data-k="${key}" aria-pressed="${cur === k}" title="${l}">${l}</button>`).join("")}</div>`; }
function qCardHTML(q) {
  const pv = q.status === "ready" ? `<img src="${q.url}" alt="변환된 사진 미리보기">` : q.status === "error" ? `<span class="wait" style="color:var(--danger);padding:10px">${esc(q.err)}</span>` : `<span class="wait">변환 중…</span>`;
  const sizes = q.status === "ready" ? `<div class="sizes"><span>원본 <b>${kb(q.origSize)}</b></span><span>→ 올릴 파일 <b>${kb(q.full.size)}</b> + 목록용 <b>${kb(q.thumb.size)}</b></span><span class="down">${Math.max(0, Math.round((1 - (q.full.size + q.thumb.size) / q.origSize) * 100))}% 줄임</span><span>${q.w}×${q.h} · 화질 ${Math.round(q.q * 100)}</span></div>` : `<div class="sizes"><span>원본 <b>${kb(q.origSize)}</b></span></div>`;
  return `<div class="qcard${q.status === "error" ? " err" : ""}" data-q="${q.id}">
    <div class="pv">${pv}</div>
    <div class="body"><div class="fine" style="word-break:break-all">${esc(q.name)}</div>${sizes}
      ${q.status === "error" ? "" : wmHTML("q:" + q.id, q.wm) + fieldsHTML(q.fields, "q:" + q.id, q.fields.note)}
      <div class="row"><button type="button" class="btn small" data-act="q-del" data-id="${q.id}" data-lock>빼기</button></div></div></div>`;
}
function tabPhotos() {
  ensurePw();
  const body = $("#tabBody");
  const ready = A.queue.filter(q => q.status === "ready").length, working = A.queue.filter(q => q.status === "processing" || q.status === "wait").length;
  body.innerHTML = `
  <section class="adm-sec"><h3>새 사진 올리기</h3>
    <label class="drop" id="drop"><input type="file" id="fileIn" accept="image/jpeg,image/png,image/webp" multiple>
      <strong>사진 고르기</strong><span>여기를 누르거나 사진을 끌어다 놓으세요. 여러 장을 한 번에 골라도 돼요.</span>
      <span class="fine">긴 변 ${FULL_EDGE}px·WebP(약 200KB)와 목록용 ${THUMB_EDGE}px로 바꾸고 워터마크를 넣어요. 위치(GPS) 같은 정보는 지워지고, 원본은 올라가지 않아요.<br>아이폰·아이패드 사진(HEIC)은 사진 앱에서 고르면 자동으로 JPG로 바뀌어 들어와요.</span></label>
    ${A.queue.length ? `<div class="qgrid" style="margin-top:12px">${A.queue.map(qCardHTML).join("")}</div>
    <div class="actbar"><span>${ready}장 준비${working ? ` · ${working}장 변환 중` : ""}${A.queue.some(q => q.status === "error") ? ` · 오류 ${A.queue.filter(q => q.status === "error").length}장` : ""}</span><span class="grow"></span>
      <button type="button" class="btn small ghost" data-act="q-clear" data-lock>모두 빼기</button>
      <button type="button" class="btn primary" data-act="q-upload" data-lock ${ready && !working ? "" : "disabled"}>${ready}장 올리기</button></div>` : ""}
  </section>
  <section class="adm-sec"><h3>올린 사진 <span class="fine">${A.pw.length ? "순서·대표 사진·설명을 고친 뒤 ‘변경 저장’을 누르세요" : ""}</span></h3>
    ${A.pw.length ? `<div class="pgrid">${A.pw.map((x, i) => `<div class="pcard${x.cover ? " cover" : ""}${x._del ? " del" : ""}" data-pw="${x.id}">
      <div class="pv">${x.cover ? `<span class="badge-c">대표</span>` : ""}<img src="${esc(photoUrl(x.thumb || x.full))}" alt="" loading="lazy"></div>
      <div class="body">${x._del ? `<div class="fine" style="color:var(--danger)">저장하면 삭제돼요</div>` : fieldsHTML(x, "p:" + x.id, A.pnotes[x.id] || "")}
        <div class="tools"><button type="button" class="btn small" data-act="p-up" data-id="${x.id}" ${i ? "" : "disabled"} aria-label="앞으로">↑</button><button type="button" class="btn small" data-act="p-down" data-id="${x.id}" ${i < A.pw.length - 1 ? "" : "disabled"} aria-label="뒤로">↓</button>
        <button type="button" class="btn small" data-act="p-cover" data-id="${x.id}" ${x.cover || x._del ? "disabled" : ""}>대표로</button>
        <button type="button" class="btn small ${x._del ? "" : "danger"}" data-act="p-del" data-id="${x.id}">${x._del ? "삭제 취소" : "삭제"}</button></div></div></div>`).join("")}</div>
      <div class="actbar"><span class="fine">워터마크 위치를 바꾸려면 삭제한 뒤 다시 올려야 해요(원본을 보관하지 않아요).</span><span class="grow"></span><button type="button" class="btn primary" data-act="p-save" data-lock ${pwDirty() ? "" : "disabled"}>변경 저장</button></div>`
      : `<p class="fine">아직 올린 사진이 없어요.</p>`}
  </section>`;
  const drop = $("#drop");
  $("#fileIn").addEventListener("change", e => { addFiles([...e.target.files]); e.target.value = ""; });
  drop.addEventListener("dragover", e => { e.preventDefault(); drop.classList.add("over"); });
  drop.addEventListener("dragleave", () => drop.classList.remove("over"));
  drop.addEventListener("drop", e => { e.preventDefault(); drop.classList.remove("over"); addFiles([...e.dataTransfer.files]); });
}
function updateQCard(q) { const el = document.querySelector(`[data-q="${q.id}"]`); if (el) el.outerHTML = qCardHTML(q); updateActbar(); }
function updateActbar() { if (A.tab === "photos" && $("#tabBody") && !document.activeElement?.closest?.(".qcard,.pcard")) { const y = scrollY; tabPhotos(); scrollTo({ top: y }); } }
async function addFiles(files) {
  for (const f of files) {
    const q = { id: uid(), file: f, name: f.name || "사진", origSize: f.size, wm: "br", status: "wait", fields: { caption: "", takenAt: "", season: "", time: "", shot: "", note: "" } };
    if (isHeic(f)) { q.status = "error"; q.err = "HEIC 사진은 바로 바꿀 수 없어요. 사진 앱에서 고르거나(자동으로 JPG가 됨) JPG로 내보내 다시 골라 주세요."; }
    else if (!/^image\//.test(f.type) && !/\.(jpe?g|png|webp)$/i.test(f.name)) { q.status = "error"; q.err = "사진 파일이 아니에요."; }
    else if (f.size > 80 * 1048576) { q.status = "error"; q.err = "파일이 너무 커요(80MB 초과)."; }
    A.queue.push(q);
  }
  tabPhotos(); runQueue();
}
let queueRunning = false;
async function runQueue() {
  if (queueRunning) return; queueRunning = true;
  try {
    for (; ;) {
      const q = A.queue.find(x => x.status === "wait"); if (!q) break;
      q.status = "processing"; updateQCard(q);
      try {
        if (!("exif" in q)) { q.exif = await readExifDate(q.file); if (q.exif && !q.fields.takenAt) q.fields.takenAt = q.exif; }
        const r = await processPhoto(q.file, q.wm);
        if (!A.queue.includes(q)) continue;
        if (q.url) URL.revokeObjectURL(q.url);
        Object.assign(q, r, { status: "ready", url: URL.createObjectURL(r.full) });
      } catch (e) { console.error(e); q.status = "error"; q.err = e.user ? e.message : "이 사진을 변환하지 못했어요 (" + (e.message || e) + ")"; }
      updateQCard(q);
    }
  } finally { queueRunning = false; updateActbar(); }
}
async function uploadQueue() {
  const rec = recOf(A.sel), items = A.queue.filter(q => q.status === "ready");
  if (!rec || !items.length) return;
  await withLock(`사진 ${items.length}장 올리기`, async prog => {
    const blobs = [], entries = [], notes = {};
    let i = 0;
    for (const q of items) {
      const id = "ph" + uid(), p = pathsFor(rec.id, id);
      prog(`사진 보내는 중 ${i + 1}/${items.length}`, i / (items.length + 1));
      blobs.push({ path: p.full, sha: await createBlob(q.full), size: q.full.size });
      blobs.push({ path: p.thumb, sha: await createBlob(q.thumb), size: q.thumb.size });
      A.local.set(p.full, URL.createObjectURL(q.full)); A.local.set(p.thumb, URL.createObjectURL(q.thumb));
      entries.push({ id, placeId: rec.id, full: p.full, thumb: p.thumb, w: q.w, h: q.h, tw: q.tw, th: q.th, bytes: q.full.size + q.thumb.size,
        caption: q.fields.caption.trim(), takenAt: q.fields.takenAt.trim(), season: q.fields.season, time: q.fields.time, shot: q.fields.shot.trim(), order: 0, cover: false, addedAt: new Date().toISOString() });
      if (q.fields.note.trim()) notes[id] = q.fields.note.trim();
      i++;
    }
    prog("사이트 목록에 반영하는 중…", items.length / (items.length + 1));
    await commitMain({ message: `사진 ${items.length}장 추가: ${nameOf(rec)}`, blobs, mutate: (P, F) => {
      const mine = F.photos.filter(x => x.placeId === rec.id);
      let ord = mine.length ? Math.max(...mine.map(x => x.order || 0)) + 1 : 0;
      const hasCover = mine.some(x => x.cover);
      entries.forEach((e, k) => { e.order = ord++; if (!hasCover && k === 0) e.cover = true; F.photos.push(e); });
    } });
    if (Object.keys(notes).length) { prog("개인 메모 저장 중…", 1); await saveNotes(N => { for (const [k, v] of Object.entries(notes)) N.photos[k] = { ...(N.photos[k] || {}), note: v }; }, `사진 메모: ${nameOf(rec)}`); }
    items.forEach(q => { q.status = "done"; q.url && URL.revokeObjectURL(q.url); });
    A.queue = A.queue.filter(q => q.status !== "done"); A.pw = null;
    renderList(); renderWork();
    banner(`<b>사진 ${items.length}장을 올렸어요.</b> 사이트에는 1~2분 뒤에 반영돼요.`, "ok"); toast(`${items.length}장을 올렸어요`);
  });
}
async function savePhotoEdits() {
  const rec = recOf(A.sel); if (!rec || !A.pw) return;
  await withLock("사진 변경 저장", async prog => {
    const pw = A.pw.map(x => ({ ...x }));
    const del = pw.filter(x => x._del), keep = pw.filter(x => !x._del);
    keep.forEach((x, i) => x.order = i);
    if (keep.length && !keep.some(x => x.cover)) keep[0].cover = true;
    prog("저장소에 반영하는 중…", 0.4);
    await commitMain({ message: `사진 정리: ${nameOf(rec)}${del.length ? ` (${del.length}장 삭제)` : ""}`, mutate: (P, F) => {
      const deletes = [];
      for (const d of del) { const cur = F.photos.find(x => x.id === d.id); if (cur) { deletes.push(cur.full); if (cur.thumb && cur.thumb !== cur.full) deletes.push(cur.thumb); } }
      F.photos = F.photos.filter(x => !del.some(d => d.id === x.id));
      for (const k of keep) { const cur = F.photos.find(x => x.id === k.id); if (!cur) continue; for (const f of ["caption", "takenAt", "season", "time", "shot", "order", "cover"]) cur[f] = typeof k[f] === "string" ? k[f].trim() : k[f]; }
      return { deletes };
    } });
    const changedNotes = pw.filter(x => (A.pnotes[x.id] || "") !== (A.N?.photos?.[x.id]?.note || "") || x._del);
    if (changedNotes.length && A.notesState !== "norepo") {
      prog("개인 메모 저장 중…", 0.8);
      await saveNotes(N => { for (const x of changedNotes) { if (x._del || !(A.pnotes[x.id] || "").trim()) delete N.photos[x.id]; else N.photos[x.id] = { ...(N.photos[x.id] || {}), note: A.pnotes[x.id].trim() }; } }, `사진 메모: ${nameOf(rec)}`);
    }
    A.pw = null; renderList(); renderWork();
    banner(`<b>저장했어요.</b> 사이트에는 1~2분 뒤에 반영돼요.`, "ok");
  });
}

/* ---------- 장소 정보 탭 (공개) ---------- */
const FORM = [
  ["name", "장소명"], ["address", "주소"], ["lat", "위도"], ["lng", "경도"], ["tags", "유형 태그", "쉼표로 구분"],
  ["intro", "소개", null, 3, true],
  ["access", "지하철·출구", "한 줄에 하나: 역 | 노선 | 출구 | 도보 (노선은 1~9, SB 수인분당, SS 신분당, GJ 경의중앙, AR 공항, GC 경춘, UI 우이신설, SL 신림, GA GTX-A)", 3, true],
  ...SHOOT_FIELDS.map(([k, l]) => [k, l, k === "highlights" ? "한 줄에 하나" : null, 2]),
  ["seasons", "계절"], ["themes", "테마"],
  ...VISIT_FIELDS.map(([k, l]) => [k, l, null, 2]),
  ["nightFact", "야간 개방", null, 2], ["official", "공식 안내", "주소(URL)나 안내 이름", 1], ["markerTheme", "마커 테마"],
];
const fid = k => "f-" + k.replace(/\./g, "-");
function toText(k, v) {
  if (v == null) return "";
  if (k === "access") return (v || []).map(a => [a.station || "", (a.lines || []).join(","), a.exit || "", a.walk || ""].join(" | ")).join("\n");
  if (k === "tags") return (v || []).join(", ");
  if (Array.isArray(v)) return v.join("\n");
  return String(v);
}
function fromText(k, t) {
  t = String(t ?? "");
  if (k === "lat" || k === "lng") { const n = parseFloat(t); return t.trim() && isFinite(n) ? n : null; }
  if (k === "tags") return t.split(/[,，]/).map(s => s.trim()).filter(Boolean);
  if (k === "access") return t.split("\n").map(l => l.trim()).filter(Boolean).map(l => { const [station = "", lines = "", exit = "", walk = ""] = l.split("|").map(s => s.trim()); return { station, lines: lines.split(/[,\s]+/).filter(Boolean), exit, walk }; });
  if (LIST_KEYS.has(k)) return t.split("\n").map(s => s.trim()).filter(Boolean);
  return t.trim() ? t.trim() : null;
}
function tabInfo() {
  const rec = recOf(A.sel), body = $("#tabBody");
  const inp = ([k, l, hint, rows, wide]) => {
    const v = val(rec, k), chg = rec.man && k in rec.man ? " chg" : "";
    if (k === "seasons" || k === "themes") { const opts = k === "seasons" ? SEASONS : THEMES; return `<div class="fld${chg}"><span>${l}</span><div class="checks">${opts.map(o => `<label><input type="checkbox" data-ck="${k}" value="${o}" ${(v || []).includes(o) ? "checked" : ""}>${o}</label>`).join("")}</div></div>`; }
    if (k === "markerTheme") return `<label class="fld${chg}"><span>${l}</span><select id="${fid(k)}"><option value="">자동(테마에 따라)</option>${[["night", "야경·일몰"], ["nature", "자연·풍경"], ["arch", "건축·스트릿"]].map(([a, b]) => `<option value="${a}" ${v === a ? "selected" : ""}>${b}</option>`).join("")}</select></label>`;
    const tv = esc(toText(k, v));
    return `<label class="fld${chg}${wide ? " wide" : ""}"><span>${l}${hint ? ` <span class="hint">${esc(hint)}</span>` : ""}</span>${rows ? `<textarea id="${fid(k)}" rows="${rows}">${tv}</textarea>` : `<input id="${fid(k)}" value="${tv}" ${k === "lat" || k === "lng" ? 'inputmode="decimal"' : ""}>`}</label>`;
  };
  body.innerHTML = `<section class="adm-sec">
    <p class="fine" style="margin-top:0">여기서 고친 값은 ‘직접 수정’으로 저장돼 조사 값보다 우선해요. 비우면 사이트에 ‘미확인’으로 보여요. <b>이 탭의 내용은 모두 공개돼요</b> — 개인적인 내용은 ‘개인 메모’ 탭에 적어 주세요.</p>
    <label class="row" style="margin:6px 0 12px"><input type="checkbox" id="pubToggle" ${rec.public !== false ? "checked" : ""}> 사이트에 이 장소 보이기</label>
    <div class="form">${FORM.map(inp).join("")}</div>
    <div class="actbar"><span class="fine" id="infoMsg"></span><span class="grow"></span><button type="button" class="btn small ghost" data-act="info-reset" data-lock>직접 수정 모두 되돌리기</button><button type="button" class="btn primary" data-act="info-save" data-lock>장소 정보 저장</button></div>
  </section>`;
}
function readInfoForm(rec) {
  const man = {};
  for (const [k] of FORM) {
    let v;
    if (k === "seasons" || k === "themes") v = [...document.querySelectorAll(`[data-ck="${k}"]:checked`)].map(x => x.value);
    else { const el = document.getElementById(fid(k)); if (!el) continue; v = fromText(k, el.value); if (k === "markerTheme") v = el.value || null; }
    const base = baseVal(rec, k);
    if (!sameV(v, base)) man[k] = v;
  }
  return man;
}
function validateMan(rec, man) {
  const nm = "name" in man ? man.name : baseVal(rec, "name");
  if (isEmptyV(nm)) return "장소명을 비울 수 없어요.";
  for (const k of ["lat", "lng"]) { const v = k in man ? man[k] : baseVal(rec, k); if (v != null && !(isFinite(v) && (k === "lat" ? v > 33 && v < 39 : v > 124 && v < 132))) return `${k === "lat" ? "위도" : "경도"} 값이 한국 범위를 벗어났어요.`; }
  return null;
}
async function saveInfo(reset) {
  const rec = recOf(A.sel); if (!rec) return;
  const man = reset ? {} : readInfoForm(rec), pub = reset ? rec.public !== false : $("#pubToggle").checked;
  const bad = validateMan(rec, man); if (bad) { toast(bad, true); return; }
  if (reset && !confirm("이 장소에서 직접 고친 값을 모두 지우고 조사 값으로 되돌릴까요?")) return;
  await withLock("장소 정보 저장", async prog => {
    prog("저장소에 반영하는 중…", 0.5);
    const sha = await commitMain({ message: `장소 정보: ${nameOf(rec)}`, mutate: P => { const r = P.places.find(x => x.id === rec.id); if (!r) throw new UserError("저장소에서 이 장소를 찾지 못했어요. 새로고침해 주세요."); if (Object.keys(man).length) r.man = man; else delete r.man; r.man = r.man || {}; r.public = pub; } });
    renderList(); renderWork();
    banner(sha ? `<b>저장했어요.</b> 사이트에는 1~2분 뒤에 반영돼요.` : "바뀐 내용이 없어요.", "ok");
  });
}

/* ---------- 개인 메모 탭 (비공개 저장소) ---------- */
function tabNotes() {
  const rec = recOf(A.sel), body = $("#tabBody"), n = noteOf(rec.id);
  if (A.notesState === "norepo") { body.innerHTML = `<div class="adm-banner">비공개 저장소 <code>${esc(cfg.notesRepo)}</code>에 접근할 수 없어요. GitHub에서 <b>Private</b> 저장소를 만들고, 토큰의 저장소 선택에 추가한 뒤 새로고침해 주세요.</div>`; return; }
  A.vis = A.vis && A.vis.pid === rec.id ? A.vis : { pid: rec.id, rows: clone(n.visits || []) };
  const research = Object.entries(n.research || {});
  body.innerHTML = `<section class="adm-sec">
    <p class="fine" style="margin-top:0">이 탭의 내용은 비공개 저장소 <code>${esc(cfg.notesRepo)}</code>에만 저장돼요. 사이트에는 나오지 않고, 토큰을 넣은 내 기기끼리 같이 보여요.</p>
    <label class="fld"><span>장소 메모</span><textarea id="noteMemo" rows="4" placeholder="취향 연결, 다음에 해 볼 구도 등">${esc(n.memo || "")}</textarea></label>
    <div class="fld"><span>방문 기록</span>
      <div id="visRows">${A.vis.rows.map((v, i) => `<div class="vrow"><input type="date" data-vi="${i}" data-vf="date" value="${esc(v.date || "")}" aria-label="방문일"><input data-vi="${i}" data-vf="note" value="${esc(v.note || "")}" placeholder="날씨·빛·혼잡" aria-label="방문 메모"><span></span><button type="button" class="btn small" data-act="vis-del" data-i="${i}">삭제</button></div>`).join("")}</div>
      <div><button type="button" class="btn small" data-act="vis-add">+ 방문 추가</button></div></div>
    ${research.length || n.geoNote ? `<details class="fld"><summary><b>조사 메모</b> <span class="fine">(예전 파일의 조사 상태 메모 · 읽기 전용)</span></summary><dl class="kvlist">${n.geoNote ? `<dt>좌표</dt><dd>${esc(n.geoNote)}</dd>` : ""}${research.map(([k, v]) => `<dt>${esc(([...VISIT_FIELDS, ...SHOOT_FIELDS].find(x => x[0] === k) || [k, { access: "지하철", official: "공식 안내", nightFact: "야간 개방", intro: "소개" }[k] || k])[1])}</dt><dd>${esc(v)}</dd>`).join("")}</dl></details>` : ""}
    <div class="actbar"><span class="fine">${A.N?.updatedAt ? "마지막 저장 " + esc(new Date(A.N.updatedAt).toLocaleString("ko-KR")) : A.notesState === "nofile" ? "아직 메모 파일이 없어요. 처음 저장하면 만들어져요." : ""}</span><span class="grow"></span><button type="button" class="btn primary" data-act="notes-save" data-lock>메모 저장</button></div>
  </section>`;
}
async function saveNotesTab() {
  const rec = recOf(A.sel); if (!rec) return;
  const memo = $("#noteMemo").value.trim(), visits = A.vis.rows.filter(v => v.date || (v.note || "").trim()).map(v => ({ date: v.date || "", note: (v.note || "").trim() }));
  await withLock("메모 저장", async () => {
    await saveNotes(N => { const cur = N.places[rec.id] || {}; const nx = { ...cur, memo: memo || undefined, visits: visits.length ? visits : undefined }; for (const k of Object.keys(nx)) if (nx[k] === undefined) delete nx[k]; if (Object.keys(nx).length) N.places[rec.id] = nx; else delete N.places[rec.id]; }, `메모: ${nameOf(rec)}`);
    A.vis = null; renderWork(); toast("메모를 저장했어요");
  });
}

/* ---------- 새 장소 ---------- */
function modal(html) { $("#modalRoot").innerHTML = `<div class="modal" role="dialog" aria-modal="true"><div class="adm-panel">${html}</div></div>`; const f = $("#modalRoot input,#modalRoot button"); f?.focus(); }
const closeModal = () => { $("#modalRoot").innerHTML = ""; };
function coordsFromText(t) {
  const s = String(t || "");
  let m = s.match(/(3[3-8]\.\d{3,})[,\s/]+(12[4-9]\.\d{3,}|13[01]\.\d{3,})/); if (m) return { lat: +m[1], lng: +m[2] };
  m = s.match(/(12[4-9]\.\d{3,}|13[01]\.\d{3,})[,\s/]+(3[3-8]\.\d{3,})/); if (m) return { lat: +m[2], lng: +m[1] };
  return null;
}
function openNewPlace() {
  modal(`<h2>새 장소</h2>
    <label class="fld"><span>장소명</span><input id="npName"></label>
    <label class="fld"><span>주소</span><input id="npAddr" placeholder="서울 종로구 …"></label>
    <label class="fld"><span>좌표 <span class="hint">‘37.5796, 126.9770’처럼 붙여 넣거나, 좌표가 들어 있는 지도 링크를 붙여 넣으세요</span></span><input id="npCoord"></label>
    <label class="fld"><span>유형 태그 <span class="hint">쉼표로 구분</span></span><input id="npTags" placeholder="거리·골목, 야경"></label>
    <p class="fine">소개·촬영 정보·방문 정보는 만든 뒤 ‘장소 정보’ 탭에서 채워요. 저장하면 사이트에 바로 공개돼요(1~2분 뒤).</p>
    <div class="mfoot"><button type="button" class="btn" data-act="modal-x">취소</button><button type="button" class="btn primary" data-act="np-save" data-lock>만들기</button></div>`);
}
async function saveNewPlace() {
  const name = $("#npName").value.trim(), address = $("#npAddr").value.trim(), c = coordsFromText($("#npCoord").value), tags = fromText("tags", $("#npTags").value);
  if (!name) { toast("장소명을 적어 주세요", true); return; }
  if ($("#npCoord").value.trim() && !c) { toast("좌표를 읽지 못했어요. ‘37.5796, 126.9770’ 형식으로 적어 주세요", true); return; }
  const dup = A.P.places.find(r => nameOf(r).replace(/\s/g, "") === name.replace(/\s/g, ""));
  if (dup && !confirm(`이름이 같은 장소(${nameOf(dup)})가 이미 있어요. 그래도 만들까요?`)) return;
  const id = "p" + uid();
  closeModal();
  await withLock("새 장소 만들기", async () => {
    await commitMain({ message: `새 장소: ${name}`, mutate: P => { P.places.push({ id, src: { name, address, lat: c?.lat ?? null, lng: c?.lng ?? null, tags }, res: {}, man: {}, public: true }); } });
    A.q = ""; $("#pq").value = ""; A.tab = "info"; selectPlace(id);
    banner(`<b>‘${esc(name)}’을 만들었어요.</b> 장소 정보를 채우고 사진을 올려 보세요.`, "ok");
  });
}

/* =====================================================================
   백업에서 옮기기 — 예전 편집본의 ‘전체 백업’ 파일에서
     · 공개 표시한 사진만 변환·워터마크 후 올림
     · 직접 고친 값·숨김 여부는 공개 데이터에, 메모·방문 기록·조사 메모는 비공개 메모로
   ===================================================================== */
let MIG = null;
function openBackup() {
  MIG = null;
  modal(`<h2>백업에서 옮기기</h2>
    <p>예전 편집본에서 저장한 <b>전체 백업</b> 파일(<code>서울출사지도-전체백업-….json</code>)을 고르세요. 파일은 이 브라우저 안에서만 읽어요.</p>
    <ul class="fine" style="margin:0 0 10px;padding-left:18px"><li>백업 안의 사진이 모두 보여요. 체크한 사진만 새 사이트에 공개돼요(처음엔 예전에 ‘공개’였던 사진만 체크).</li><li>메모·방문 기록·사진 메모는 비공개 저장소로만 가요.</li><li>이미 옮긴 사진은 다시 올리지 않으니, 중간에 멈춰도 다시 하면 돼요.</li><li>사진이 많으면 노트북에서 하는 게 좋아요.</li></ul>
    <label class="btn primary" style="cursor:pointer">백업 파일 고르기<input type="file" id="bkIn" accept="application/json,.json" hidden></label>
    <div id="bkBody"></div>
    <div class="mfoot"><button type="button" class="btn" data-act="modal-x" id="bkClose">닫기</button></div>`);
  $("#bkIn").addEventListener("change", e => { const f = e.target.files[0]; if (f) readBackup(f); });
}
function codeOfKind(k) { return KIND_CODE[k] || "r"; }
async function readBackup(file) {
  await withLock("백업 파일 읽기", async prog => {
    prog(`${kb(file.size)} 읽는 중…`);
    let j; try { j = JSON.parse(await file.text()); } catch (e) { throw new UserError("백업 파일을 읽지 못했어요. 이 앱의 JSON 백업 파일인지 확인해 주세요."); }
    if (j.app !== "seoul-photo-spots") throw new UserError("이 앱의 백업 파일이 아니에요.");
    if ((j.version || 0) < 5) throw new UserError("예전 버전(5 이전) 백업이에요. 예전 편집본에서 한 번 열어 새로 전체 백업을 저장해 주세요.");
    if (j.kind !== "full" || !(j.photos || []).some(p => p.fullData)) { if (!confirm("사진이 들어 있지 않은 백업이에요(‘장소만’). 장소 수정값과 메모만 옮길까요?")) return; }
    const P = A.P, ids = new Set(P.places.map(r => r.id));
    const plan = { man: [], hide: [], newPlaces: [], memos: 0, visits: 0, research: 0, photos: [], skippedDone: 0, skippedNoPlace: 0 };
    const publicIds = new Set();
    for (const rec of j.places || []) {
      const pub = rec.public !== false;
      if (ids.has(rec.id)) {
        const man = {}; for (const [k, v] of Object.entries(rec.man || {})) if (EDIT_KEYS.includes(k)) man[k] = v;
        if (Object.keys(man).length) plan.man.push({ id: rec.id, man });
        if (!pub) plan.hide.push(rec.id); else publicIds.add(rec.id);
      } else if (pub && (rec.src?.name || rec.man?.name)) {
        plan.newPlaces.push(rec); publicIds.add(rec.id);
      }
      if (rec.memo) plan.memos++; if ((rec.visits || []).length) plan.visits++;
      if (Object.values(rec.res || {}).some(m => m && m.note)) plan.research++;
    }
    for (const r of P.places) if (r.public !== false && !plan.hide.includes(r.id)) publicIds.add(r.id);
    const have = new Set(A.F.photos.map(x => x.id));
    for (const ph of j.photos || []) {
      if (!ph.fullData) continue;
      if (!ph.placeId || !publicIds.has(ph.placeId)) { plan.skippedNoPlace++; continue; }
      const id = safeId(ph.id); if (have.has(id)) { plan.skippedDone++; continue; }
      plan.photos.push({ id, src: ph, wm: "br", status: "wait", pick: !!ph.public });
    }
    MIG = { j, plan };
    drawMigration();
  });
}
const placeLabel = id => recOf(id) ? nameOf(recOf(id)) : (MIG?.plan.newPlaces.find(r => r.id === id)?.src?.name || "");
function drawMigration() {
  const { plan } = MIG, el = $("#bkBody"); if (!el) return;
  const picked = plan.photos.filter(p => p.pick), ready = picked.filter(p => p.status === "ready").length;
  const wasPub = plan.photos.filter(p => p.src.public).length;
  // 장소별로 묶어서 보여 줌
  const groups = new Map(); plan.photos.forEach((p, i) => { const k = p.src.placeId; if (!groups.has(k)) groups.set(k, []); groups.get(k).push([p, i]); });
  const fig = ([p, i]) => `<figure class="${p.pick ? "picked" : ""}">
      <label class="pick"><input type="checkbox" data-mpick="${i}" ${p.pick ? "checked" : ""} aria-label="이 사진 옮기기">
        <img src="${p.status === "ready" ? p.url : esc(p.src.thumbData || p.src.fullData)}" alt="" loading="lazy">
        ${p.src.public ? "" : `<span class="was">예전 비공개</span>`}</label>
      <figcaption>${esc(p.src.caption || "")}${p.status === "ready" ? ` · ${kb(p.full.size)}` : p.status === "error" ? " · 변환 오류" : ""}</figcaption>
      ${p.status === "ready" && p.pick ? `<div class="wm">${WM_POS.map(([k, l]) => `<button type="button" data-mwm="${k}" data-i="${i}" aria-pressed="${p.wm === k}" title="워터마크 ${l}">${{ br: "↘", bl: "↙", bc: "↓", tr: "↗", tl: "↖" }[k]}</button>`).join("")}</div>` : ""}</figure>`;
  el.innerHTML = `<h3 style="margin:14px 0 6px">옮길 내용</h3>
    <ul class="steplist">
      <li class="${MIG.doneData ? "done" : ""}">장소 정보: 직접 고친 값 ${plan.man.length}곳 · 숨김 ${plan.hide.length}곳 · 내가 추가한 장소 ${plan.newPlaces.length}곳</li>
      <li class="${MIG.doneNotes ? "done" : ""}">비공개 메모: 장소 메모 ${plan.memos}곳 · 방문 기록 ${plan.visits}곳 · 조사 메모 ${plan.research}곳 · 사진 메모</li>
      <li class="${MIG.donePhotos ? "done" : ""}">사진: ${plan.photos.length}장 중 <b>${picked.length}장 선택</b>${plan.skippedDone ? ` · 이미 옮긴 ${plan.skippedDone}장 건너뜀` : ""}${plan.skippedNoPlace ? ` · 장소가 없거나 숨김인 ${plan.skippedNoPlace}장 제외` : ""}</li>
    </ul>
    ${plan.photos.length ? `<p class="fine" style="margin:4px 0 8px">체크한 사진만 새 사이트에 공개돼요. 처음에는 예전 편집본에서 ‘공개’였던 사진(${wasPub}장)만 체크돼 있어요. 사진을 누르면 체크가 바뀌어요.</p>
    <div class="row mig-tools">
      <button type="button" class="btn small" data-act="mig-all">모두 선택</button>
      <button type="button" class="btn small" data-act="mig-none">모두 해제</button>
      <button type="button" class="btn small" data-act="mig-pub">예전 공개만</button>
      <span class="grow"></span>
      <button type="button" class="btn small" data-act="mig-convert" data-lock ${picked.some(p => p.status === "wait") ? "" : "disabled"}>미리 변환해 보기</button>
      <span class="fine">${ready}/${picked.length}장 변환됨</span></div>
    <div class="mig-groups">${[...groups].map(([pid, list]) => `<section class="mig-g"><div class="mig-gh"><b>${esc(placeLabel(pid) || pid)}</b><span class="fine">${list.filter(([p]) => p.pick).length}/${list.length}</span>
        <button type="button" class="btn small ghost" data-act="mig-place" data-pid2="${esc(pid)}">${list.every(([p]) => p.pick) ? "이 장소 해제" : "이 장소 모두 선택"}</button></div>
      <div class="mini-grid">${list.map(fig).join("")}</div></section>`).join("")}</div>
    <p class="fine">워터마크는 오른쪽 아래로 들어가요. 위치를 바꾸려면 ‘미리 변환해 보기’ 뒤에 사진 아래 화살표를 누르세요. 변환하지 않고 바로 ‘옮기기 시작’을 눌러도 돼요.</p>` : `<p class="fine">옮길 사진이 없어요.</p>`}
    <div class="mfoot"><button type="button" class="btn primary" data-act="mig-run" data-lock>${MIG.donePhotos && !picked.length ? "다 옮겼어요 · 닫기" : picked.length ? `옮기기 시작 (사진 ${picked.length}장)` : "옮기기 시작 (사진 없이)"}</button></div>`;
}
async function migConvert(only) { await withLock("사진 변환", prog => migConvertIn(prog, only)); }
async function migConvertIn(prog, only) {
  {
    const list = only != null ? [MIG.plan.photos[only]] : MIG.plan.photos.filter(p => p.pick && p.status === "wait");
    let i = 0;
    for (const p of list) {
      prog(`변환 중 ${i + 1}/${list.length}`, i / list.length); i++;
      try {
        const blob = await (await fetch(p.src.fullData)).blob();
        const r = await processPhoto(blob, p.wm);
        if (p.url) URL.revokeObjectURL(p.url);
        Object.assign(p, r, { status: "ready", url: URL.createObjectURL(r.thumb) });
      } catch (e) { console.error(e); p.status = "error"; }
    }
    drawMigration();
  }
}
function compactRes(res, sources) {
  const out = {};
  for (const [k, m] of Object.entries(res || {})) {
    if (!m || !EDIT_KEYS.includes(k)) continue;
    const code = codeOfKind(m.k);
    if (code === "u" || isEmptyV(m.v)) { out[k] = ["u"]; continue; }
    const ids = [];
    if (code !== "s") for (const s of m.src || []) {
      if (!s || !s.u) continue;
      let key = Object.keys(sources).find(x => sources[x].u === s.u);
      if (!key) { key = "b" + Object.keys(sources).length.toString(36) + uid().slice(-3); sources[key] = { t: s.t || "", u: s.u }; }
      ids.push(key);
    }
    out[k] = code === "s" ? [code, m.v] : [code, m.v, ids];
  }
  return out;
}
async function migRun() {
  const { j, plan } = MIG;
  const picked = plan.photos.filter(p => p.pick);
  if (MIG.donePhotos && !picked.length) { closeModal(); return; }
  if (!picked.length && plan.photos.length && !confirm("선택한 사진이 없어요. 사진 없이 장소 정보와 메모만 옮길까요?")) return;
  const pickedIds = new Set(picked.map(p => p.id));
  await withLock("백업에서 옮기기", async prog => {
    if (picked.some(p => p.status === "wait")) await migConvertIn((m, f) => prog("사진 " + m, f == null ? null : f * 0.3));
    // 1) 공개 장소 데이터
    if (!MIG.doneData && (plan.man.length || plan.hide.length || plan.newPlaces.length)) {
      prog("장소 정보 반영 중…", 0.05);
      await commitMain({ message: "백업에서 옮기기: 장소 정보", mutate: P => {
        for (const { id, man } of plan.man) { const r = P.places.find(x => x.id === id); if (r) r.man = { ...(r.man || {}), ...man }; }
        for (const id of plan.hide) { const r = P.places.find(x => x.id === id); if (r) r.public = false; }
        for (const rec of plan.newPlaces) {
          if (P.places.some(x => x.id === rec.id)) continue;
          const s = rec.src || {};
          const man = {}; for (const [k, v] of Object.entries(rec.man || {})) if (EDIT_KEYS.includes(k)) man[k] = v;
          P.places.push({ id: rec.id, src: { name: s.name || "", address: s.address || "", lat: s.lat ?? null, lng: s.lng ?? null, tags: s.tags || (s.mcidName ? [s.mcidName] : []) }, res: compactRes(rec.res, P.sources), man, public: true });
        }
      } });
    }
    MIG.doneData = true; drawMigration();
    // 2) 비공개 메모
    if (!MIG.doneNotes && A.notesState !== "norepo") {
      prog("비공개 메모 저장 중…", 0.1);
      await saveNotes(N => {
        for (const rec of j.places || []) {
          const n = { ...(N.places[rec.id] || {}) };
          if (rec.memo && !n.memo) n.memo = rec.memo;
          if ((rec.visits || []).length) { const seen = new Set((n.visits || []).map(v => v.date + "|" + v.note)); n.visits = [...(n.visits || []), ...rec.visits.map(v => ({ date: v.date || "", note: v.note || "" })).filter(v => !seen.has(v.date + "|" + v.note))]; }
          for (const [k, m] of Object.entries(rec.res || {})) if (m && m.note) { n.research = n.research || {}; if (!n.research[k]) n.research[k] = m.note; }
          if (Object.keys(n).length) N.places[rec.id] = n;
        }
        for (const ph of j.photos || []) { const id = safeId(ph.id); if (ph.note && pickedIds.has(id)) N.photos[id] = { ...(N.photos[id] || {}), note: ph.note }; }
      }, "백업에서 옮기기: 메모");
    }
    MIG.doneNotes = true; drawMigration();
    // 3) 공개 사진: 10장씩 한 커밋
    const todo = plan.photos.filter(p => p.pick && p.status === "ready");
    for (let s = 0; s < todo.length; s += 10) {
      const chunk = todo.slice(s, s + 10), blobs = [], entries = [];
      for (const [k, p] of chunk.entries()) {
        prog(`사진 보내는 중 ${s + k + 1}/${todo.length}`, 0.15 + 0.85 * (s + k) / todo.length);
        const pa = pathsFor(p.src.placeId, p.id);
        blobs.push({ path: pa.full, sha: await createBlob(p.full), size: p.full.size }, { path: pa.thumb, sha: await createBlob(p.thumb), size: p.thumb.size });
        A.local.set(pa.thumb, p.url);
        const x = p.src;
        entries.push({ id: p.id, placeId: x.placeId, full: pa.full, thumb: pa.thumb, w: p.w, h: p.h, tw: p.tw, th: p.th, bytes: p.full.size + p.thumb.size,
          caption: x.caption || "", takenAt: x.takenAt || "", season: x.season || "", time: x.time || "", shot: x.shot || "", order: x.order || 0, cover: !!x.cover, addedAt: x.addedAt || new Date().toISOString() });
      }
      await commitMain({ message: `백업에서 옮기기: 사진 ${s + 1}~${s + chunk.length}`, blobs, mutate: (P, F) => {
        for (const e of entries) if (!F.photos.some(y => y.id === e.id)) { if (e.cover && F.photos.some(y => y.placeId === e.placeId && y.cover)) e.cover = false; F.photos.push(e); }
        for (const pid of new Set(entries.map(e => e.placeId))) { const mine = F.photos.filter(y => y.placeId === pid).sort((a, b) => (a.order || 0) - (b.order || 0)); if (mine.length && !mine.some(y => y.cover)) mine[0].cover = true; }
      } });
      chunk.forEach(p => p.status = "done");
    }
    MIG.donePhotos = true; MIG.doneNotes = false; plan.skippedDone += todo.length; plan.photos = plan.photos.filter(p => p.status !== "done"); plan.photos.forEach(p => p.pick = false); drawMigration();
    renderList(); if (A.sel) { A.pw = null; renderWork(); }
    const errs = plan.photos.filter(p => p.status === "error").length;
    banner(`<b>백업에서 옮기기를 마쳤어요.</b> 사진 ${todo.length}장${errs ? ` (변환 오류 ${errs}장은 건너뜀)` : ""}. 사이트에는 1~2분 뒤에 반영돼요.`, "ok");
  });
}

/* ---------- 설정 ---------- */
function openSettings() {
  modal(`<h2>설정</h2>
    <div class="form">
      <label class="fld"><span>GitHub 사용자 이름</span><input id="sOwner" value="${esc(cfg.owner)}"></label>
      <label class="fld"><span>사이트 저장소 (공개)</span><input id="sRepo" value="${esc(cfg.repo)}"></label>
      <label class="fld"><span>브랜치</span><input id="sBranch" value="${esc(cfg.branch)}"></label>
      <label class="fld"><span>사이트 폴더 <span class="hint">본 주소는 비움, 시험 주소는 beta/</span></span><input id="sPrefix" value="${esc(cfg.prefix)}" placeholder="(비움)"></label>
      <label class="fld"><span>메모 저장소 (비공개)</span><input id="sNotes" value="${esc(cfg.notesRepo)}"></label>
    </div>
    <p class="fine">지금 주소에서 자동으로 고른 폴더: <code>${esc(detectPrefix() || "(본 주소)")}</code></p>
    <h3 style="margin:14px 0 6px;font-size:15px">메모 파일 가져오기</h3>
    <p class="fine" style="margin:0 0 6px">예전 파일에서 뽑아 둔 <code>notes-initial.json</code>을 고르면, 비어 있는 칸만 채워 비공개 메모에 합쳐요(이미 적은 메모는 그대로).</p>
    <label class="btn small" style="cursor:pointer">메모 파일 고르기<input type="file" id="notesIn" accept="application/json,.json" hidden></label>
    <h3 style="margin:14px 0 6px;font-size:15px">이 기기의 토큰</h3>
    <p class="fine" style="margin:0 0 6px">${token ? "이 브라우저에 저장돼 있어요." : "저장된 토큰이 없어요."} 다른 사람이 쓰는 기기라면 작업 뒤 지워 주세요.</p>
    <button type="button" class="btn small danger" data-act="token-clear">이 기기에서 토큰 지우기</button>
    <div class="mfoot"><button type="button" class="btn" data-act="modal-x">닫기</button><button type="button" class="btn primary" data-act="cfg-save">저장하고 다시 불러오기</button></div>`);
  $("#notesIn").addEventListener("change", e => { const f = e.target.files[0]; if (f) importNotesFile(f); });
}
async function importNotesFile(f) {
  let j; try { j = JSON.parse(await f.text()); } catch (e) { toast("메모 파일을 읽지 못했어요", true); return; }
  if (!j || !j.places) { toast("메모 파일 형식이 아니에요", true); return; }
  closeModal();
  await withLock("메모 파일 가져오기", async () => {
    let n = 0;
    await saveNotes(N => {
      for (const [id, v] of Object.entries(j.places)) { const cur = N.places[id] || {}; const nx = { ...cur };
        for (const k of ["memo", "geoNote"]) if (v[k] && !nx[k]) { nx[k] = v[k]; n++; }
        if (v.research) { nx.research = { ...(v.research), ...(nx.research || {}) }; n++; }
        if (v.visits && !nx.visits) nx.visits = v.visits;
        N.places[id] = nx; }
      for (const [id, v] of Object.entries(j.photos || {})) if (!N.photos[id]) N.photos[id] = v;
    }, "메모 파일 가져오기");
    if (A.sel) renderWork(); toast(`메모를 합쳤어요 (${n}항목)`);
  });
}

/* =====================================================================
   시작 · 토큰 확인
   ===================================================================== */
async function verifyToken(t) {
  const repo = await gh("GET", R(), null, { token: t });
  if (!repo.permissions || !repo.permissions.push) throw new UserError(`토큰에 ${cfg.repo} 쓰기 권한이 없어요. ‘Contents: Read and write’로 만들었는지 확인해 주세요.`);
  return repo;
}
async function loadAll() {
  banner(null);
  $("#repoLine").textContent = `${cfg.owner}/${cfg.repo} · ${cfg.branch}${cfg.prefix ? " · " + cfg.prefix : " · 본 주소"}`;
  const repo = await verifyToken(token);
  A.repo = repo; A.sizeKB = repo.size || 0; renderMeter();
  const ref = await gh("GET", `${R()}/git/ref/heads/${encodeURIComponent(cfg.branch)}`);
  const { P, F } = await readMain(ref.object.sha);
  A.P = P; A.F = F;
  const nrepo = await gh("GET", NR(), null, { allow404: true }).catch(() => null);
  if (!nrepo) { A.notesState = "norepo"; A.N = null; banner(`비공개 메모 저장소 <code>${esc(cfg.notesRepo)}</code>에 접근할 수 없어요. GitHub에서 Private 저장소로 만들고 토큰의 저장소 선택에 추가하면 개인 메모를 쓸 수 있어요. 사진 올리기는 지금도 돼요.`); }
  else if (!nrepo.private) { A.notesState = "norepo"; banner(`<b>주의:</b> 메모 저장소 <code>${esc(cfg.notesRepo)}</code>가 공개 저장소예요. 개인 메모가 공개되지 않도록 GitHub에서 Private으로 바꾸기 전까지 메모 저장을 막아 뒀어요.`); }
  else { const { N } = await readNotes(); A.N = N || EMPTY_NOTES(); A.notesState = N ? "ok" : "nofile"; }
  $("#setup").hidden = true; $("#main").hidden = false; $("#backupBtn").hidden = false;
  renderList(); renderWork();
}
function showSetup(msg) {
  $("#setup").hidden = false; $("#main").hidden = true; $("#backupBtn").hidden = true; $("#meter").hidden = true;
  $("#stRepo").textContent = cfg.repo; $("#stNotes").textContent = cfg.notesRepo;
  $("#tokenMsg").textContent = msg || "";
  $("#repoLine").textContent = `${cfg.owner}/${cfg.repo}`;
}
async function start() {
  if (!token) { showSetup(); return; }
  await withLock("저장소 불러오기", async prog => {
    prog("GitHub에서 최신 데이터를 받는 중…");
    try { await loadAll(); }
    catch (e) { if (e.status === 401) { token = ""; lsSet(TOKEN_KEY, null); showSetup("저장된 토큰이 만료됐거나 맞지 않아요. 새 토큰을 넣어 주세요."); return; } showSetup(); throw e; }
  });
}

/* ---------- 이벤트 ---------- */
$("#tokenSave").addEventListener("click", async () => {
  const t = $("#tokenIn").value.trim();
  if (!/^(github_pat_|ghp_)[A-Za-z0-9_]{20,}$/.test(t)) { $("#tokenMsg").textContent = "토큰 형식이 아니에요. github_pat_로 시작하는 값을 그대로 붙여 넣어 주세요."; return; }
  await withLock("토큰 확인", async () => {
    await verifyToken(t);
    token = t; if (!lsSet(TOKEN_KEY, t)) toast("이 브라우저에 저장할 수 없어 이번 창에서만 써요(개인 정보 보호 모드 등)", true);
    $("#tokenIn").value = "";
  });
  if (token) start();
});
$("#tokenIn").addEventListener("keydown", e => { if (e.key === "Enter") $("#tokenSave").click(); });
$("#settingsBtn").addEventListener("click", openSettings);
$("#backupBtn").addEventListener("click", openBackup);
$("#newPlaceBtn").addEventListener("click", openNewPlace);
$("#pq").addEventListener("input", e => { A.q = e.target.value; renderList(); });
$("#onlyPhotos").addEventListener("change", e => { A.onlyPhotos = e.target.checked; renderList(); });

document.addEventListener("input", e => {
  const t = e.target;
  if (t.dataset.f && t.dataset.k) {
    const [kind, id] = t.dataset.k.split(":");
    if (kind === "q") { const q = A.queue.find(x => x.id === id); if (q) q.fields[t.dataset.f] = t.value; }
    else if (kind === "p") { const x = A.pw?.find(y => y.id === id); if (!x) return; if (t.dataset.f === "note") A.pnotes[id] = t.value; else x[t.dataset.f] = t.value; const b = document.querySelector('[data-act="p-save"]'); if (b) b.disabled = !pwDirty(); }
  }
  if (t.dataset.vi != null && A.vis) A.vis.rows[+t.dataset.vi][t.dataset.vf] = t.value;
});
document.addEventListener("change", e => { if (e.target.tagName === "SELECT") e.target.dispatchEvent(new Event("input", { bubbles: true })); });
document.addEventListener("click", async e => {
  const pid = e.target.closest("[data-pid]"); if (pid) { selectPlace(pid.dataset.pid); return; }
  const tab = e.target.closest("[data-tab]"); if (tab) { if (A.tab === "photos" && pwDirty() && !confirm("저장하지 않은 사진 변경이 있어요. 다른 탭으로 갈까요?")) return; A.tab = tab.dataset.tab; A.pw = null; renderWork(); return; }
  const wm = e.target.closest("[data-wm]");
  if (wm) { const q = A.queue.find(x => "q:" + x.id === wm.dataset.k); if (q && q.wm !== wm.dataset.wm && q.status !== "processing") { q.wm = wm.dataset.wm; q.status = "wait"; updateQCard(q); runQueue(); } return; }
  const mp = e.target.closest("[data-mpick]");
  if (mp) { const p = MIG.plan.photos[+mp.dataset.mpick]; if (p) { p.pick = mp.checked; drawMigration(); } return; }
  const mwm = e.target.closest("[data-mwm]"); if (mwm) { const p = MIG.plan.photos[+mwm.dataset.i]; if (p && p.wm !== mwm.dataset.mwm) { p.wm = mwm.dataset.mwm; p.status = "wait"; migConvert(+mwm.dataset.i); } return; }
  const t = e.target.closest("[data-act]"); if (!t || t.disabled) return;
  const a = t.dataset.act, id = t.dataset.id;
  if (a === "banner-x") banner(null);
  else if (a === "back") selectPlace(null);
  else if (a === "q-del") { const q = A.queue.find(x => x.id === id); if (q?.url) URL.revokeObjectURL(q.url); A.queue = A.queue.filter(x => x.id !== id); tabPhotos(); }
  else if (a === "q-clear") { if (confirm("변환한 사진을 모두 목록에서 뺄까요?")) { A.queue.forEach(q => q.url && URL.revokeObjectURL(q.url)); A.queue = []; tabPhotos(); } }
  else if (a === "q-upload") uploadQueue();
  else if (a === "p-up" || a === "p-down") { const i = A.pw.findIndex(x => x.id === id), j = i + (a === "p-up" ? -1 : 1); if (i >= 0 && j >= 0 && j < A.pw.length) { [A.pw[i], A.pw[j]] = [A.pw[j], A.pw[i]]; A.pw.forEach((x, k) => x.order = k); tabPhotos(); } }
  else if (a === "p-cover") { A.pw.forEach(x => x.cover = x.id === id); tabPhotos(); }
  else if (a === "p-del") { const x = A.pw.find(y => y.id === id); if (x) { x._del = !x._del; if (x._del && x.cover) { x.cover = false; const n = A.pw.find(y => !y._del); if (n) n.cover = true; } } tabPhotos(); }
  else if (a === "p-save") savePhotoEdits();
  else if (a === "info-save") saveInfo(false);
  else if (a === "info-reset") saveInfo(true);
  else if (a === "notes-save") saveNotesTab();
  else if (a === "vis-add") { A.vis.rows.push({ date: new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" }), note: "" }); const memo = $("#noteMemo").value; tabNotes(); $("#noteMemo").value = memo; }
  else if (a === "vis-del") { A.vis.rows.splice(+t.dataset.i, 1); const memo = $("#noteMemo").value; tabNotes(); $("#noteMemo").value = memo; }
  else if (a === "modal-x") closeModal();
  else if (a === "np-save") saveNewPlace();
  else if (a === "mig-convert") migConvert();
  else if (a === "mig-all" || a === "mig-none" || a === "mig-pub") { MIG.plan.photos.forEach(p => p.pick = a === "mig-all" ? true : a === "mig-none" ? false : !!p.src.public); drawMigration(); }
  else if (a === "mig-place") { const list = MIG.plan.photos.filter(p => p.src.placeId === t.dataset.pid2); const on = !list.every(p => p.pick); list.forEach(p => p.pick = on); drawMigration(); }
  else if (a === "mig-run") migRun();
  else if (a === "token-clear") { if (confirm("이 기기에서 토큰을 지울까요? 다시 올리려면 토큰을 새로 넣어야 해요.")) { token = ""; lsSet(TOKEN_KEY, null); closeModal(); location.reload(); } }
  else if (a === "cfg-save") {
    const nx = { owner: $("#sOwner").value.trim(), repo: $("#sRepo").value.trim(), branch: $("#sBranch").value.trim() || "main", prefix: $("#sPrefix").value.trim().replace(/^\/+/, ""), notesRepo: $("#sNotes").value.trim() };
    if (nx.prefix && !nx.prefix.endsWith("/")) nx.prefix += "/";
    if (!nx.owner || !nx.repo || !nx.notesRepo) { toast("빈 칸이 있어요", true); return; }
    cfg = { ...cfg, ...nx }; lsSet(CFG_KEY, JSON.stringify(cfg)); closeModal(); location.reload();
  }
});
document.addEventListener("keydown", e => { if (e.key === "Escape" && $("#modalRoot").innerHTML && !A.busy) closeModal(); });
start();
