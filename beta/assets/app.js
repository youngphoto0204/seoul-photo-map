"use strict";
/* =====================================================================
   1. 상수
   장소 데이터는 4층으로 나눈다.
     src  : 네이버 JSON 원본 값
     res  : 외부 조사로 보강한 값 (값·종류·출처·확인일)
     man  : 내가 직접 수정한 값 (표시할 때 가장 우선)
     memo·visits·사진 : 개인 기록 (공개 여부를 항목마다 선택)
   ===================================================================== */
const APP_VERSION = 5;
const IN_ARTIFACT = false;
const DATA_URL = {places:"data/places.json", photos:"data/photos.json"};
const PUBLIC_MODE = true; // 방문자용 페이지: 읽기 전용. 편집·업로드는 admin.html에서
const DB_NAME = "seoul-photo-map-v5";      // 새 저장소. 예전 장소가 되살아나지 않도록 분리
const LEGACY_DB = "seoul-photo-spots";     // 이전 버전 저장소. 읽기만 하고 절대 쓰지 않음
const LEGACY_SCRIPT = "seoul-photo-map 261106 001.photos.js";
// 배경 지도: 라이트·다크 모두 같은 OpenFreeMap 스타일을 불러온 뒤, 디자인 시스템의 map-paint JSON으로 색만 덮어씀(design-system/docs/map-style.md)
const BASE_STYLE = "https://tiles.openfreemap.org/styles/positron";
const STYLES = {light:BASE_STYLE, dark:BASE_STYLE};
const MAP_PAINT = (()=>{ const r=id=>{ try { return JSON.parse(document.getElementById(id).textContent); } catch(e){ console.warn(id,e); return null; } }; return {light:r("mapPaintLight"), dark:r("mapPaintDark")}; })();
const BASE_SOURCE = "openmaptiles";
/* map-style.md의 applyPhotoMapStyle: 배경 지도 레이어에만 적용하고 앱이 그린 철도·마커·해달 레이어는 건드리지 않음.
   파일을 fetch하지 않고 HTML에 넣어 둔 JSON을 씀(공개본이 파일 하나라서) */
function applyPhotoMapStyle(map, theme){
  const paint=MAP_PAINT[theme]; if (!map || !paint) return;
  for (const layer of map.getStyle().layers||[]){
    if (layer.type==="background"){ for (const [k,v] of Object.entries(paint.background||{})) try { map.setPaintProperty(layer.id,k,v); } catch(e){} continue; }
    if (layer.source!==BASE_SOURCE) continue;
    for (const rule of paint.rules||[]){
      if (rule.type && rule.type!==layer.type) continue;
      if (rule.sourceLayer && rule.sourceLayer!==layer["source-layer"]) continue;
      if (rule.idMatch && !new RegExp(rule.idMatch).test(layer.id)) continue;
      if (rule.hide){ map.setLayoutProperty(layer.id,"visibility","none"); continue; }
      for (const [k,v] of Object.entries(rule.paint||{})){ try { map.setPaintProperty(layer.id,k,v); } catch(e){ /* 그 레이어에 없는 속성은 건너뜀 */ } }
    }
  }
}
const SEASONS = ["봄","여름","가을","겨울"];
/* 추천 시간대 필터: ‘추천 시간대’(bestTime) 글에서 낱말을 찾아 네 묶음으로 나눔. 날씨·계절 낱말은 무시 */
const TIME_SLOTS = ["일출·아침","낮","일몰","야간"];
const TIME_RX = {"일출·아침":/일출|새벽|아침|오전/, "낮":/낮/, "일몰":/일몰|노을|해 ?질|매직/, "야간":/야간|밤|저녁|블루/};
function timeSlotsOf(p){ const v=p.bestTime, t=Array.isArray(v)?v.join(" "):String(v||""); return TIME_SLOTS.filter(s=>TIME_RX[s].test(t)); }
const THEMES = ["벚꽃","단풍","야경","일몰","도시·건축","골목","자연","한강","인물"];
const KINDS_ALL = [["unchecked","미확인 항목 있음"],["review","재확인 필요"],["nostation","역 미확인"],["manual","직접 수정함"],["record","메모·방문 기록"],["nocoord","위치 확인 필요"],["outside","서울 외"]];
const KINDS = KINDS_ALL.filter(([k])=>!["manual","record"].includes(k));
const TIMES = ["","새벽","오전","한낮","오후","일몰·매직아워","블루아워","야간"];
const DISTRICTS = ["종로구","중구","용산구","성동구","광진구","동대문구","중랑구","성북구","강북구","도봉구","노원구","은평구","서대문구","마포구","양천구","강서구","구로구","금천구","영등포구","동작구","관악구","서초구","강남구","송파구","강동구"];
const LINES = {
  "1":{n:"1호선",c:"#0052A4"}, "2":{n:"2호선",c:"#00A84D"}, "3":{n:"3호선",c:"#EF7C1C"}, "4":{n:"4호선",c:"#00A5DE"},
  "5":{n:"5호선",c:"#996CAC"}, "6":{n:"6호선",c:"#CD7C2F"}, "7":{n:"7호선",c:"#747F00"}, "8":{n:"8호선",c:"#E6186C"},
  "9":{n:"9호선",c:"#BDB092"}, "SB":{n:"수인분당선",c:"#F5A200"}, "SS":{n:"신분당선",c:null}, "GJ":{n:"경의중앙선",c:null},
  "AR":{n:"공항철도",c:null}, "GC":{n:"경춘선",c:null}, "UI":{n:"우이신설선",c:null}, "SL":{n:"신림선",c:null}, "GA":{n:"GTX-A",c:null}
};
const LINE_ORDER = Object.keys(LINES);
const VISIT_FIELDS = [["notes.hours","운영시간"],["notes.closed","휴무일"],["notes.fee","입장료"],["notes.reserve","예약"],["notes.entrance","출입구·접근"],["notes.walk","도보 참고"],["notes.tripod","삼각대"],["notes.restrict","촬영 제한"],["notes.caution","주의사항"]];
const SHOOT_FIELDS = [["highlights","소재·포인트"],["composition","추천 구도"],["focal","초점거리"],["bestTime","추천 시간대"],["seasonIdeas","계절 아이디어"],["night","야경 아이디어"],["care","혼잡·안전·사생활"],["position","위치·방향 참고"]];
const FIELD_LABEL = Object.fromEntries([...VISIT_FIELDS,...SHOOT_FIELDS,["access","지하철 접근"],["official","공식 안내"],["nightFact","야간 개방"],["seasons","계절"],["themes","테마"],["tags","유형 태그"],["district","자치구"],["intro","소개"],["name","장소명"],["address","주소"],["lat","위도"],["lng","경도"]]);
const LIST_KEYS = new Set(["highlights","seasons","themes","tags","access"]);
const EDIT_KEYS = ["name","address","district","tags","lat","lng","intro","access","official",...VISIT_FIELDS.map(x=>x[0]),"nightFact",...SHOOT_FIELDS.map(x=>x[0]),"seasons","themes","markerTheme"];
FIELD_LABEL.markerTheme = "마커 테마";
/* 지도 마커 테마(design-system MapMarker): night 야경·일몰 / nature 자연·풍경 / arch 건축·스트릿.
   편집에서 고른 값(markerTheme)이 있으면 그것을, 없으면 테마 낱말로 자동 결정:
   야경·일몰 → night, 없고 자연·단풍·벚꽃·한강 → nature, 나머지 → arch */
const MARKER_THEMES = ["night","nature","arch"];
const MARKER_THEME_NAME = {night:"야경·일몰", nature:"자연·풍경", arch:"건축·스트릿"};
const MARKER_GLYPH = {
  night:  '<path d="M3 18h18M7 18a5 5 0 0 1 10 0M12 7v2.5M5.5 11l1.6 1.6M18.5 11l-1.6 1.6"/>',
  nature: '<path d="M3 19 9.5 7.5l4 6.5 2.5-3.5L21 19z"/>',
  arch:   '<path d="M6 20V7l6-3 6 3v13M10 20v-4h4v4M9.5 10h.01M14.5 10h.01M9.5 13.5h.01M14.5 13.5h.01"/>'
};
function autoMarkerTheme(p){ const t=(p.themes||[]).join(" "); return /야경|일몰/.test(t)?"night":/자연|단풍|벚꽃|한강/.test(t)?"nature":"arch"; }
function markerThemeOf(p){ return MARKER_THEMES.includes(p.markerTheme) ? p.markerTheme : autoMarkerTheme(p); }
const RESEARCH_KEYS = EDIT_KEYS.filter(k=>!["name","address","lat","lng","district","tags"].includes(k));
const REQUIRED_KEYS = ["access","official",...VISIT_FIELDS.map(x=>x[0]),"nightFact"];
const STALE_DAYS = 180;
const KIND_CODE = {f:"fact",r:"ref",s:"suggest",u:"unknown"};

/* =====================================================================
   3. 상태와 도우미
   ===================================================================== */
const TAG_ORDER = ["여행","카페","생활/문화","교육","쇼핑","교통","지도정보"];
const S = {
  store:null, stored:{places:[],archive:[],photos:[]}, places:[], photos:[],
  f:{q:"",seasons:new Set(),themes:new Set(),times:new Set(),tags:new Set(),lines:new Set(),kinds:new Set(),photo:false},
  sel:null, view:"list", photoIdx:0, downloads:null,
  sun:{date:null, min:null, show:true},
  selMode:false, selSet:new Set(), notice:null
};
const gpsHints = new Map(); // 사진 EXIF 좌표: 메모리에만 두고 저장하지 않음
function uid(){ return Date.now().toString(36)+Math.random().toString(36).slice(2,8); }
function esc(s){ return String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }
function unk(v, label="확인 필요"){ return (v===null||v===undefined||String(v).trim()==="") ? `<span class="tag warn">${label}</span>` : esc(v); }
const $ = s=>document.querySelector(s);
const clone = o=>JSON.parse(JSON.stringify(o));
const isMobile = ()=>matchMedia("(max-width:899px)").matches;
const SEOUL_DATE = new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Seoul",year:"numeric",month:"2-digit",day:"2-digit"});
const SEOUL_TIME = new Intl.DateTimeFormat("ko-KR",{timeZone:"Asia/Seoul",hour:"2-digit",minute:"2-digit",hourCycle:"h23"});
const SEOUL_STAMP = new Intl.DateTimeFormat("ko-KR",{timeZone:"Asia/Seoul",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23"});
const today = ()=>SEOUL_DATE.format(new Date());
const stamp = iso=>{ try { return SEOUL_STAMP.format(new Date(iso)); } catch(e){ return iso||""; } };
function isEmptyV(v){ return v==null || (Array.isArray(v) ? !v.length : String(v).trim()===""); }
function canon(v){ return JSON.stringify(v??null,(k,x)=>x===""?null:(x&&typeof x==="object"&&!Array.isArray(x))?Object.keys(x).sort().reduce((o,kk)=>(o[kk]=x[kk]===""||x[kk]===undefined?null:x[kk],o),{}):x); }
function sameV(a,b){ return (isEmptyV(a)&&isEmptyV(b)) || canon(a)===canon(b); }
function getF(p,k){ return k.startsWith("notes.") ? (p.notes||{})[k.slice(6)] : p[k]; }
function setF(p,k,v){ if (k.startsWith("notes.")) p.notes={...(p.notes||{}), [k.slice(6)]:v}; else p[k]=v; }

/* ---------- 층 합치기: 직접 수정 > 조사 > JSON 원본 ---------- */
function districtFromAddr(addr){ const m=String(addr||"").match(/^서울(?:특별시|시)?\s+(\S+구)(?=\s|$)/); return m&&DISTRICTS.includes(m[1])?m[1]:null; }
function baseValue(rec,k){
  const s=rec.src||{};
  if (k==="name") return (s.displayName&&String(s.displayName).trim())||s.name||"";
  if (k==="address") return s.address||"";
  if (k==="lat"||k==="lng") return s[k]??null;
  if (k==="tags") return Array.isArray(s.tags)&&s.tags.length ? s.tags.slice() : (s.mcidName?[s.mcidName]:[]);
  if (k==="district") return districtFromAddr(s.address);
  const r=rec.res?.[k];
  return r ? r.v : (LIST_KEYS.has(k)?[]:null);
}
function fieldValue(rec,k){ return rec.man && Object.prototype.hasOwnProperty.call(rec.man,k) ? rec.man[k] : baseValue(rec,k); }
function flatten(rec){
  const p={id:rec.id, origin:"user", public:rec.public!==false, memo:rec.memo||null, memoPublic:!!rec.memoPublic, visits:rec.visits||[], review:rec.review||null, links:rec.links||{}, notes:{}, addedAt:rec.addedAt||null, updatedAt:rec.updatedAt||null};
  for (const k of EDIT_KEYS) setF(p,k,clone(fieldValue(rec,k)??null));
  for (const k of LIST_KEYS) if (p[k]==null) p[k]=[];
  if (rec.src?.sid||rec.src?.bookmarkId) p.naver={...rec.src};
  p.edited=Object.keys(rec.man||{});
  p.fieldMeta={};
  for (const [k,m] of Object.entries(rec.res||{})) p.fieldMeta[k]={k:m.k,src:m.src||[],at:m.at||null,note:m.note||null};
  return p;
}
function storedOf(id){ return S.stored.places.find(p=>p.id===id)||null; }
function mergePlaces(){
  S.places = S.store?.flat ? (S.stored.places||[]) : S.stored.places.map(flatten);
  S.photos = S.stored.photos.slice().sort((a,b)=>(a.order??0)-(b.order??0));
}
function photosOf(pid){ return S.photos.filter(p=>p.placeId===pid); }
function coverOf(pid){ const ps=photosOf(pid); return ps.find(p=>p.cover)||ps[0]||null; }
function getPlace(id){ return S.places.find(p=>p.id===id); }
function normName(s){ return String(s||"").toLowerCase().replace(/[\s·.,()\[\]\-_'"!?]/g,""); }
function distM(a,b){ const R=6371000,toR=Math.PI/180; const dLa=(b.lat-a.lat)*toR,dLo=(b.lng-a.lng)*toR; const x=Math.sin(dLa/2)**2+Math.cos(a.lat*toR)*Math.cos(b.lat*toR)*Math.sin(dLo/2)**2; return 2*R*Math.asin(Math.sqrt(x)); }
function hasCoord(p){ return !!p && typeof p.lat==="number" && typeof p.lng==="number" && isFinite(p.lat) && isFinite(p.lng); }
const PROV=/^(경기|인천|부산|대구|광주|대전|울산|세종|강원|충북|충청|충남|전북|전라|전남|경북|경상|경남|제주)/;
function regionOf(p){
  const a=(p.address||"").trim();
  if (/^서울/.test(a)) return "seoul";
  if (PROV.test(a)) return "outside";
  if (hasCoord(p)) return (p.lat>=37.41&&p.lat<=37.72&&p.lng>=126.73&&p.lng<=127.27) ? "seoul" : "outside";
  return "unknown";
}
const districtOf = districtFromAddr;
function missingKeys(p){ return REQUIRED_KEYS.filter(k=>k==="access"?!hasStation(p):isEmptyV(getF(p,k))); }
function hasStation(p){ return (p.access||[]).some(a=>a.station); }
function kindMatch(p,k){
  if (k==="outside") return regionOf(p)==="outside";
  if (k==="nocoord") return !hasCoord(p);
  if (k==="unchecked") return missingKeys(p).length>0;
  if (k==="review") return !!p.review;
  if (k==="nostation") return !hasStation(p);
  if (k==="manual") return (p.edited||[]).length>0;
  if (k==="record") return !!p.memo || (p.visits||[]).length>0;
  return false;
}
function matches(p, f){
  const q=f.q.trim().toLowerCase();
  if (q){
    const hay=[p.name,p.district,p.address,p.intro,p.memo,...(p.tags||[]),...(p.themes||[]),...(p.seasons||[]),...(p.highlights||[]),...(p.access||[]).map(a=>a.station)].join(" ").toLowerCase();
    if (!q.split(/\s+/).every(w=>hay.includes(w))) return false;
  }
  if (f.photo && !photosOf(p.id).length) return false;
  if (f.seasons.size && !(p.seasons||[]).some(s=>f.seasons.has(s))) return false;
  if (f.themes.size && !(p.themes||[]).some(t=>f.themes.has(t))) return false;
  if (f.times?.size && !timeSlotsOf(p).some(t=>f.times.has(t))) return false;
  if (f.tags.size && !(p.tags||[]).some(t=>f.tags.has(t))) return false;
  if (f.lines.size && !(p.access||[]).some(a=>(a.lines||[]).some(l=>f.lines.has(l)))) return false;
  if (f.kinds.size && ![...f.kinds].some(k=>kindMatch(p,k))) return false;
  return true;
}
function visible(){ return S.places.filter(p=>matches(p,S.f)); }

/* ---------- 초기 데이터: HTML에 내장된 새 JSON + 조사 결과를 층 구조로 ---------- */
function expandResearch(raw, sources, at){
  const res={};
  for (const [k,e] of Object.entries(raw||{})){
    const [code,val,ids,note,at2]=e, kind=KIND_CODE[code]||"ref", src=(ids||[]).map(i=>sources[i]).filter(Boolean), when=at2||at;
    res[k]= kind==="unknown" ? {v:LIST_KEYS.has(k)?[]:null,k:kind,src,at:when,note:typeof val==="string"?val:null} : {v:val,k:kind,src:kind==="suggest"?[]:src,at:when,note:note||null};
  }
  return res;
}
/* =====================================================================
   4. 태양 계산 — SunCalc(V. Agafonkin, BSD-2) 알고리즘을 그대로 옮김.
      골든아워: 태양 고도 -4°~+6°, 블루아워: -6°~-4°, 일출·일몰: -0.833°(대기 굴절·태양 반지름 보정)
   ===================================================================== */
const SC=(()=>{
  const PI=Math.PI, rad=PI/180, dayMs=864e5, J1970=2440588, J2000=2451545, e=rad*23.4397, J0=0.0009;
  const toJulian=d=>d.valueOf()/dayMs-0.5+J1970, fromJulian=j=>new Date((j+0.5-J1970)*dayMs), toDays=d=>toJulian(d)-J2000;
  const ra=(l,b)=>Math.atan2(Math.sin(l)*Math.cos(e)-Math.tan(b)*Math.sin(e),Math.cos(l));
  const decl=(l,b)=>Math.asin(Math.sin(b)*Math.cos(e)+Math.cos(b)*Math.sin(e)*Math.sin(l));
  const azim=(H,phi,dec)=>Math.atan2(Math.sin(H),Math.cos(H)*Math.sin(phi)-Math.tan(dec)*Math.cos(phi));
  const alti=(H,phi,dec)=>Math.asin(Math.sin(phi)*Math.sin(dec)+Math.cos(phi)*Math.cos(dec)*Math.cos(H));
  const sidereal=(d,lw)=>rad*(280.16+360.9856235*d)-lw;
  const meanAnom=d=>rad*(357.5291+0.98560028*d);
  const eclLong=M=>{ const C=rad*(1.9148*Math.sin(M)+0.02*Math.sin(2*M)+0.0003*Math.sin(3*M)); return M+C+rad*102.9372+PI; };
  function getPosition(date,lat,lng){ const lw=rad*-lng, phi=rad*lat, d=toDays(date), M=meanAnom(d), L=eclLong(M), dec=decl(L,0), r=ra(L,0), H=sidereal(d,lw)-r; return {azimuth:azim(H,phi,dec), altitude:alti(H,phi,dec)}; }
  const cycle=(d,lw)=>Math.round(d-J0-lw/(2*PI));
  const approx=(Ht,lw,n)=>J0+(Ht+lw)/(2*PI)+n;
  const transitJ=(ds,M,L)=>J2000+ds+0.0053*Math.sin(M)-0.0069*Math.sin(2*L);
  const hourAngle=(h,phi,d)=>Math.acos((Math.sin(h)-Math.sin(phi)*Math.sin(d))/(Math.cos(phi)*Math.cos(d)));
  function getTimes(date,lat,lng,angles){
    const lw=rad*-lng, phi=rad*lat, d=toDays(date), n=cycle(d,lw), ds=approx(0,lw,n), M=meanAnom(ds), L=eclLong(M), dec=decl(L,0), Jnoon=transitJ(ds,M,L);
    const out={solarNoon:fromJulian(Jnoon)};
    for (const [ang,riseName,setName] of angles){
      const w=hourAngle(ang*rad,phi,dec), Jset=transitJ(approx(w,lw,n),M,L), Jrise=Jnoon-(Jset-Jnoon);
      out[riseName]=fromJulian(Jrise); out[setName]=fromJulian(Jset);
    }
    return out;
  }
  return {getPosition,getTimes};
})();
/* =====================================================================
   달 계산 (MOON) — Jean Meeus, 『Astronomical Algorithms』 2판 47장의 주요 항(경도 30항·위도 13항·거리 13항)과
   48장(밝은 면 비율)을 옮긴 것. 위상 순간(삭·상현·보름·하현)은 달과 해의 황경 차가 0·90·180·270°가 되는
   시각을 이분법으로 찾음. 시각은 UTC Date 객체로 다루고, 화면 표시는 Asia/Seoul로 바꿈.
   월출·월몰: 달 윗가장자리가 표준 대기굴절(34′)을 포함한 지평선에 닿는 순간
   (기준 고도 h0 = 0.7275×지평시차 − 0.5667°). 지형·건물은 반영하지 않음.
   ===================================================================== */
const MOON = (() => {
  const R = Math.PI / 180, DT_SEC = 69; // ΔT(TT−UT) 근사 69초
  const n360 = x => ((x % 360) + 360) % 360;
  const jd = date => date.getTime() / 864e5 + 2440587.5;
  const fromJd = j => new Date((j - 2440587.5) * 864e5);
  // [D, M, M', F, Σl(1e-6°), Σr(1e-3 km)]
  const LR = [
    [0,0,1,0,6288774,-20905355],[2,0,-1,0,1274027,-3699111],[2,0,0,0,658314,-2955968],[0,0,2,0,213618,-569925],
    [0,1,0,0,-185116,48888],[0,0,0,2,-114332,-3149],[2,0,-2,0,58793,246158],[2,-1,-1,0,57066,-152138],
    [2,0,1,0,53322,-170733],[2,-1,0,0,45758,-204586],[0,1,-1,0,-40923,-129620],[1,0,0,0,-34720,108743],
    [0,1,1,0,-30383,104755],[2,0,0,-2,15327,10321],[0,0,1,2,-12528,0],[0,0,1,-2,10980,79661],
    [4,0,-1,0,10675,-34782],[0,0,3,0,10034,-23210],[4,0,-2,0,8548,-21636],[2,1,-1,0,-7888,24208],
    [2,1,0,0,-6766,30824],[1,0,-1,0,-5163,-8379],[1,1,0,0,4987,-16675],[2,-1,1,0,4036,-12831],
    [2,0,2,0,3994,-10445],[4,0,0,0,3861,-11650],[2,0,-3,0,3665,14403],[0,1,-2,0,-2689,-7003],
    [2,0,-1,2,-2602,0],[2,-1,-2,0,2390,10056]
  ];
  // [D, M, M', F, Σb(1e-6°)]
  const B = [
    [0,0,0,1,5128122],[0,0,1,1,280602],[0,0,1,-1,277693],[2,0,0,-1,173237],[2,0,-1,1,55413],[2,0,-1,-1,46271],
    [2,0,0,1,32573],[0,0,2,1,17198],[2,0,1,-1,9266],[0,0,2,-1,8822],[2,-1,0,-1,8216],[2,0,-2,-1,4324],[2,0,1,1,4200]
  ];
  function args(T) {
    return {
      Lp: n360(218.3164477 + 481267.88123421 * T - 0.0015786 * T * T),
      D: n360(297.8501921 + 445267.1114034 * T - 0.0018819 * T * T),
      M: n360(357.5291092 + 35999.0502909 * T - 0.0001536 * T * T),
      Mp: n360(134.9633964 + 477198.8675055 * T + 0.0087414 * T * T),
      F: n360(93.2720950 + 483202.0175233 * T - 0.0036539 * T * T),
      E: 1 - 0.002516 * T - 0.0000074 * T * T
    };
  }
  const Tof = date => (jd(date) + DT_SEC / 86400 - 2451545) / 36525;
  function moonEcl(date) {
    const T = Tof(date), a = args(T);
    const A1 = n360(119.75 + 131.849 * T), A2 = n360(53.09 + 479264.290 * T), A3 = n360(313.45 + 481266.484 * T);
    let sl = 0, sr = 0, sb = 0;
    for (const [d, m, mp, f, l, r] of LR) {
      const arg = (d * a.D + m * a.M + mp * a.Mp + f * a.F) * R, e = Math.abs(m) === 1 ? a.E : Math.abs(m) === 2 ? a.E * a.E : 1;
      sl += l * e * Math.sin(arg); sr += r * e * Math.cos(arg);
    }
    for (const [d, m, mp, f, b] of B) {
      const arg = (d * a.D + m * a.M + mp * a.Mp + f * a.F) * R, e = Math.abs(m) === 1 ? a.E : 1;
      sb += b * e * Math.sin(arg);
    }
    sl += 3958 * Math.sin(A1 * R) + 1962 * Math.sin((a.Lp - a.F) * R) + 318 * Math.sin(A2 * R);
    sb += -2235 * Math.sin(a.Lp * R) + 382 * Math.sin(A3 * R) + 175 * Math.sin((A1 - a.F) * R) + 175 * Math.sin((A1 + a.F) * R)
        + 127 * Math.sin((a.Lp - a.Mp) * R) - 115 * Math.sin((a.Lp + a.Mp) * R);
    return { lon: n360(a.Lp + sl / 1e6), lat: sb / 1e6, dist: 385000.56 + sr / 1000, T, a };
  }
  function sunLon(date) {
    const T = Tof(date), L0 = 280.46646 + 36000.76983 * T + 0.0003032 * T * T, M = (357.52911 + 35999.05029 * T - 0.0001537 * T * T) * R;
    const C = (1.914602 - 0.004817 * T - 0.000014 * T * T) * Math.sin(M) + (0.019993 - 0.000101 * T) * Math.sin(2 * M) + 0.000289 * Math.sin(3 * M);
    return n360(L0 + C);
  }
  function elong(date) { return n360(moonEcl(date).lon - sunLon(date)); }   // 0=삭, 90=상현, 180=보름, 270=하현
  function illum(date) {
    const { a } = moonEcl(date);
    const i = 180 - a.D - 6.289 * Math.sin(a.Mp * R) + 2.100 * Math.sin(a.M * R) - 1.274 * Math.sin((2 * a.D - a.Mp) * R)
      - 0.658 * Math.sin(2 * a.D * R) - 0.214 * Math.sin(2 * a.Mp * R) - 0.110 * Math.sin(a.D * R);
    return (1 + Math.cos(i * R)) / 2;
  }
  function equ(date) {
    const m = moonEcl(date), eps = (23.439291 - 0.0130042 * m.T) * R, l = m.lon * R, b = m.lat * R;
    const ra = Math.atan2(Math.sin(l) * Math.cos(eps) - Math.tan(b) * Math.sin(eps), Math.cos(l));
    const dec = Math.asin(Math.sin(b) * Math.cos(eps) + Math.cos(b) * Math.sin(eps) * Math.sin(l));
    return { ra, dec, dist: m.dist };
  }
  function gmst(date) { return n360(280.46061837 + 360.98564736629 * (jd(date) - 2451545)) * R; }
  // 지심 고도(굴절·시차 미보정), 방위(북 0°, 동 90°)
  function geoAltAz(date, lat, lng) {
    const q = equ(date), H = gmst(date) + lng * R - q.ra, phi = lat * R;
    const alt = Math.asin(Math.sin(phi) * Math.sin(q.dec) + Math.cos(phi) * Math.cos(q.dec) * Math.cos(H));
    const az = Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(phi) - Math.tan(q.dec) * Math.cos(phi));
    return { alt: alt / R, az: n360(az / R + 180), par: Math.asin(6378.14 / q.dist) / R, dist: q.dist };
  }
  // 화면용: 관측자 위치(지표) 기준 겉보기 고도 = 지심 고도 − 시차 + 대기굴절(Bennett, 지평선 근처는 근사)
  function position(date, lat, lng) {
    const g = geoAltAz(date, lat, lng);
    const topo = g.alt - g.par * Math.cos(g.alt * R);
    const h = Math.max(topo, -1.9);
    const refr = topo > -1 ? 1.02 / Math.tan((h + 10.3 / (h + 5.11)) * R) / 60 : 0;
    return { alt: topo + refr, az: g.az, dist: g.dist };
  }
  // 하루(Asia/Seoul 00:00~24:00) 안의 월출·월몰. 없으면 null
  function riseSet(dateStr, lat, lng) {
    const t0 = new Date(dateStr + "T00:00:00+09:00").getTime(), step = 10 * 60000;
    const f = t => { const g = geoAltAz(new Date(t), lat, lng); return g.alt - (0.7275 * g.par - 0.5667); };
    let rise = null, set = null, prev = f(t0), above = prev > 0, anyAbove = above, anyBelow = !above;
    for (let t = t0 + step; t <= t0 + 864e5; t += step) {
      const v = f(t);
      if (v > 0) anyAbove = true; else anyBelow = true;
      if ((prev <= 0) !== (v <= 0)) {
        let lo = t - step, hi = t, flo = prev;
        for (let k = 0; k < 20; k++) { const mid = (lo + hi) / 2, fm = f(mid); if ((flo <= 0) === (fm <= 0)) { lo = mid; flo = fm; } else hi = mid; }
        const when = new Date((lo + hi) / 2);
        if (when.getTime() < t0 + 864e5) {
          if (prev <= 0 && v > 0 && !rise) rise = when;
          if (prev > 0 && v <= 0 && !set) set = when;
        }
      }
      prev = v;
    }
    const azOf = d => d ? geoAltAz(d, lat, lng).az : null;
    return { rise, set, riseAz: azOf(rise), setAz: azOf(set), alwaysUp: anyAbove && !anyBelow, alwaysDown: anyBelow && !anyAbove };
  }
  // 위상 순간: 황경 차가 target(0/90/180/270)이 되는 시각. from 이후 첫 번째
  function nextPhase(from, target) {
    const g = d => { let x = elong(d) - target; x = ((x + 540) % 360) - 180; return x; };
    let t = from.getTime(), step = 6 * 3600e3, prev = g(new Date(t));
    for (let k = 0; k < 140; k++) {
      const t2 = t + step, v = g(new Date(t2));
      if (prev < 0 && v >= 0 && v - prev < 90) {
        let lo = t, hi = t2;
        for (let i = 0; i < 40; i++) { const mid = (lo + hi) / 2; if (g(new Date(mid)) < 0) lo = mid; else hi = mid; }
        return new Date((lo + hi) / 2);
      }
      t = t2; prev = v;
    }
    return null;
  }
  function prevNew(at) {
    const g = d => { let x = elong(d); x = ((x + 540) % 360) - 180; return x; };
    let t = at.getTime(), step = 6 * 3600e3, cur = g(new Date(t));
    for (let k = 0; k < 140; k++) {
      const t1 = t - step, v = g(new Date(t1));
      if (v < 0 && cur >= 0 && cur - v < 90) {
        let lo = t1, hi = t;
        for (let i = 0; i < 40; i++) { const mid = (lo + hi) / 2; if (g(new Date(mid)) < 0) lo = mid; else hi = mid; }
        return new Date((lo + hi) / 2);
      }
      t = t1; cur = v;
    }
    return null;
  }
  // 위상 이름(황경 차 기준). '무렵' 이름은 정확한 위상 순간이 아니라 그 모양에 가깝다는 뜻
  function phaseInfo(date) {
    const e = elong(date), frac = illum(date), waxing = e < 180;
    let name, key;
    if (e < 7 || e >= 353) { name = "삭 무렵 (거의 안 보임)"; key = "new"; }
    else if (e < 83) { name = "초승달"; key = "wxc"; }
    else if (e < 97) { name = "상현달 무렵"; key = "fq"; }
    else if (e < 173) { name = "차오르는 달"; key = "wxg"; }
    else if (e < 187) { name = "보름달 무렵"; key = "full"; }
    else if (e < 263) { name = "기우는 달"; key = "wng"; }
    else if (e < 277) { name = "하현달 무렵"; key = "lq"; }
    else { name = "그믐달"; key = "wnc"; }
    const pn = prevNew(date);
    return { elong: e, frac, waxing, name, key, age: pn ? (date - pn) / 864e5 : null, prevNew: pn };
  }
  return { position, riseSet, nextPhase, prevNew, phaseInfo, elong, illum, sunLon };
})();


const SUN_ANGLES=[[-0.833,"sunrise","sunset"],[-6,"dawn","dusk"],[-4,"blueEndM","blueStartE"],[6,"goldEndM","goldStartE"]];
const DIR16=["북","북북동","북동","동북동","동","동남동","남동","남남동","남","남남서","남서","서남서","서","서북서","북서","북북서"];
function compass(azRad){ return ((azRad*180/Math.PI)+180+360)%360; }
function dirName(deg){ return isFinite(deg) ? DIR16[Math.round(deg/22.5)%16] : ""; }
function fmtT(d){ return d && isFinite(d) ? SEOUL_TIME.format(d) : "—"; }
function kstMin(d){ return ((d.getTime()/60000+540)%1440+1440)%1440; }
function atKst(dateStr, min){ return new Date(new Date(dateStr+"T00:00:00+09:00").getTime()+min*60000); }
function sunDay(p, dateStr){
  const t=SC.getTimes(new Date(dateStr+"T12:00:00+09:00"), p.lat, p.lng, SUN_ANGLES);
  t.riseAz=isFinite(t.sunrise)?compass(SC.getPosition(t.sunrise,p.lat,p.lng).azimuth):NaN;
  t.setAz=isFinite(t.sunset)?compass(SC.getPosition(t.sunset,p.lat,p.lng).azimuth):NaN;
  t.dayMin=(isFinite(t.sunset)&&isFinite(t.sunrise))?Math.round((t.sunset-t.sunrise)/60000):NaN;
  return t;
}
function selMin(t,date){ return S.sun.min!=null ? S.sun.min : (date===today() ? Math.round(kstMin(new Date())/5)*5 : (isFinite(t.goldStartE) ? Math.round(kstMin(t.goldStartE)/5)*5 : 1080)); }
function dur(min){ return isFinite(min) ? `${Math.floor(min/60)}시간 ${String(min%60).padStart(2,"0")}분` : "—"; }
function destPoint(lat,lng,brgDeg,dist){
  const R=6371000, d=dist/R, b=brgDeg*Math.PI/180, f1=lat*Math.PI/180, l1=lng*Math.PI/180;
  const f2=Math.asin(Math.sin(f1)*Math.cos(d)+Math.cos(f1)*Math.sin(d)*Math.cos(b));
  const l2=l1+Math.atan2(Math.sin(b)*Math.sin(d)*Math.cos(f1),Math.cos(d)-Math.sin(f1)*Math.sin(f2));
  return [l2*180/Math.PI, f2*180/Math.PI];
}

/* =====================================================================
   6. 외부 지도·길찾기 링크 (외부 지도를 여는 것이지, 앱에서 경로를 계산하지 않음)
      카카오: apis.map.kakao.com/web/guide 지도 URL  /  구글: Maps URLs  /  네이버 앱: URL Scheme(nmap://)
      네이버 웹 장소 주소(map.naver.com/p/entry/place/ID)는 공식 문서가 없는 형식
   ===================================================================== */
function cleanName(n){ return String(n).replace(/,/g," ").trim(); }
function safeUrl(u){ try { const x=new URL(u); return /^https?:$/.test(x.protocol) ? x.href : null; } catch(e){ return null; } }
function appName(){ return (location.protocol==="https:"||location.protocol==="http:") ? location.origin : "seoul-photo-map.local"; }
const IS_PHONE = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent||"");
function mapLinks(p){
  const nm=cleanName(p.name), c=hasCoord(p), ll=c?`${p.lat},${p.lng}`:"", q=encodeURIComponent(nm+" "+(p.address||"서울"));
  const saved=p.links?.naver && safeUrl(p.links.naver);
  return {
    google: c?`https://www.google.com/maps/search/?api=1&query=${ll}`:`https://www.google.com/maps/search/?api=1&query=${q}`,
    kakao: c?`https://map.kakao.com/link/map/${encodeURIComponent(nm)},${ll}`:`https://map.kakao.com/link/search/${encodeURIComponent(nm)}`,
    naverWeb: saved || (p.naver?.sid ? `https://map.naver.com/p/entry/place/${encodeURIComponent(p.naver.sid)}` : `https://map.naver.com/p/search/${encodeURIComponent(nm)}`),
    naverWebKind: saved ? "saved" : p.naver?.sid ? "sid" : "search",
    naverApp: c?`nmap://place?lat=${p.lat}&lng=${p.lng}&name=${encodeURIComponent(nm)}&appname=${encodeURIComponent(appName())}`:`nmap://search?query=${encodeURIComponent(nm)}&appname=${encodeURIComponent(appName())}`
  };
}
function routeLinks(p, mode, origin){
  const nm=cleanName(p.name), c=hasCoord(p), ll=c?`${p.lat},${p.lng}`:"";
  const walk=mode==="walk";
  const oCoord=origin&&typeof origin.lat==="number"?origin:null, oText=origin&&origin.text?origin.text:null;
  let g=`https://www.google.com/maps/dir/?api=1&destination=${c?ll:encodeURIComponent(nm+" "+(p.address||"서울"))}&travelmode=${walk?"walking":"transit"}`;
  if (oCoord) g+=`&origin=${oCoord.lat},${oCoord.lng}`; else if (oText) g+=`&origin=${encodeURIComponent(oText)}`;
  let k=null, kNote="";
  if (c){
    if (oCoord){ k=`https://map.kakao.com/link/by/${walk?"walk":"traffic"}/${encodeURIComponent(cleanName(oCoord.name||"출발지"))},${oCoord.lat},${oCoord.lng}/${encodeURIComponent(nm)},${ll}`; kNote=walk?"도보 길찾기로 열려요":"대중교통 길찾기로 열려요"; }
    else { k=`https://map.kakao.com/link/to/${encodeURIComponent(nm)},${ll}`; kNote = oText ? "카카오 주소 형식은 글자 출발지를 받지 않아 목적지만 넣어요. 출발지·수단은 카카오맵에서 고르세요" : "목적지만 넣어 열어요. 출발지·수단은 카카오맵에서 고르세요"; }
  }
  let n=null;
  if (c){
    n=`nmap://route/${walk?"walk":"public"}?dlat=${p.lat}&dlng=${p.lng}&dname=${encodeURIComponent(nm)}`;
    if (oCoord) n+=`&slat=${oCoord.lat}&slng=${oCoord.lng}&sname=${encodeURIComponent(oCoord.name||"출발지")}`;
    n+=`&appname=${encodeURIComponent(appName())}`;
  }
  return {google:g, kakao:k, kakaoNote:kNote, naverApp:n, naverWeb:mapLinks(p).naverWeb};
}


/* =====================================================================
   7. 실제 지도 (MapLibre + OpenFreeMap): 숫자 묶음(클러스터), 사진 표시, 해 방향
   ===================================================================== */
const MAP={m:null,state:"idle",mode:"tiles",pick:null,popup:null,hover:null,timer:null,src:null,font:"Noto Sans Regular",groups:[],sunMk:[],rtMk:[],app:{photoOnly:false,sun:true,moon:true,rail:true,places:true}};
const BASE_GROUPS=[["rail","지하철·철도","#00A84D",/(rail|transit|subway)/i],["poi","관광지·가게 이름","#2E5872",/^poi/i],["road","도로 이름","#8A7A5A",/(highway|road|street|transportation).*(name|label|shield)|(name|label).*(highway|road)/i],["water","강·물 이름","#6B8F9E",/(water.*(name|label)|mountain|peak|park.*label)/i]];
function mapMsg(state,msg){
  const el=$("#mapState"); MAP.state=state;
  const ready=state==="ready";
  $("#layerChips").hidden=!ready; $("#legend").hidden=!ready; $("#fitBtn").hidden=!ready;
  if (ready){ el.hidden=true; el.innerHTML=""; return; }
  el.hidden=false;
  el.innerHTML = state==="loading"
    ? `<div class="ms-box" role="status"><span class="spin" aria-hidden="true"></span><strong>지도를 불러오는 중</strong><span>OpenFreeMap 서버에서 지도 데이터를 받고 있어요.</span></div>`
    : `<div class="ms-box" role="alert"><strong>지도를 불러오지 못했어요</strong><span>${esc(msg)}</span><button type="button" class="btn small primary" data-act="map-retry">다시 시도</button><span class="fine">목록·해 시간·사진·외부 지도 버튼은 그대로 쓸 수 있어요.</span></div>`;
}
function mapFailText(err){
  
  return "지도 서버에 연결하지 못했어요. 인터넷 연결을 확인한 뒤 다시 시도하세요."+(err&&err.message?` (${err.message})`:"");
}
function basicStyle(){ return {version:8,sources:{},layers:[{id:"bg",type:"background",paint:{"background-color":cssVar("--map-land")}}]}; }
/* mode "tiles": OpenFreeMap 배경 지도. 실패하면 "basic": 배경 없이 철도·출사지·방향선만 (가짜 지도를 그리지 않음) */
function initMap(mode){
  const view = MAP.m && MAP.state==="ready" ? {center:MAP.m.getCenter(), zoom:MAP.m.getZoom()} : (MAP.lastView||null);
  if (MAP.m){ try{ MAP.m.remove(); }catch(e){} MAP.m=null; MAP.popup=null; MAP.sunMk=[]; RAIL.labels=[]; MAP.rtMk=[]; MAP.obsMk=null; MAP.stPop=null; }
  clearTimeout(MAP.timer);
  $("#mapNote").hidden=true;
  if (!window.maplibregl){ mapMsg("fail", "지도 프로그램(MapLibre)을 내려받지 못했어요. 인터넷 연결을 확인한 뒤 다시 시도하세요. 목록·사진·해·달·경로 찾기(목록)는 그대로 쓸 수 있어요."); return; }
  MAP.mode = mode || "tiles"; MAP.styleTheme = effTheme();
  mapMsg("loading");
  let m;
  try {
    m=new maplibregl.Map({container:"map", style: MAP.mode==="tiles" ? STYLES[MAP.styleTheme] : basicStyle(),
      center:view?view.center:[126.978,37.5665], zoom:view?view.zoom:10.3,
      attributionControl:{compact:true, customAttribution:"철도 © OpenStreetMap contributors (ODbL)"}, dragRotate:false, pitchWithRotate:false});
  } catch(e){ if (MAP.mode==="tiles"){ MAP.basicWhy=mapFailText(e); initMap("basic"); } else mapMsg("fail","지도를 만들지 못했어요 ("+(e.message||e)+")"); return; }
  MAP.m=m; MAP.first=!view;
  m.touchZoomRotate.disableRotation();
  m.addControl(new maplibregl.NavigationControl({showCompass:false}),"top-right");
  if (MAP.mode==="tiles") MAP.timer=setTimeout(()=>{ if(MAP.state==="loading"){ MAP.basicWhy=mapFailText(); initMap("basic"); } },12000);
  m.on("load",()=>{
    clearTimeout(MAP.timer);
    try { if (MAP.mode==="tiles") applyPhotoMapStyle(m, effTheme()); quietBase(m); baseGroups(); addAppLayers(); bindAppHandlers(); } catch(e){ console.warn(e); }
    mapMsg("ready"); afterLayers(); if (MAP.first) fitVisible(); showBasicNote();
  });
  m.on("error",e=>{ if (MAP.state==="loading" && MAP.mode==="tiles" && !m.isStyleLoaded()){ clearTimeout(MAP.timer); MAP.basicWhy=mapFailText(e&&e.error); initMap("basic"); } });
  m.on("click",e=>{ if(MAP.pick){ const cb=MAP.pick; endPick(); cb(e.lngLat); } });
  m.on("moveend",()=>{ MAP.lastView={center:m.getCenter(),zoom:m.getZoom()}; updateLabels(); });
}
function showBasicNote(){
  const el=$("#mapNote");
  if (MAP.mode!=="basic"){ el.hidden=true; return; }
  el.innerHTML=`<span>배경 지도 없이 철도망·출사지·방향선만 표시 중이에요.<span class="why"> ${esc(MAP.basicWhy||"")}</span></span><button type="button" class="btn" data-act="map-retry">배경 지도 다시 시도</button><button type="button" class="btn" data-act="note-x" aria-label="안내 닫기">닫기</button>`;
  el.hidden=false;
}
document.addEventListener("click",e=>{ if (e.target.closest('[data-act="note-x"]')) $("#mapNote").hidden=true; });
/* 배경 지도 다듬기: 큰 도시·나라 이름(‘서울특별시’가 출사지 위를 덮음)과 도로 번호판은 숨김 */
function quietBase(m){
  for (const l of m.getStyle().layers||[]){
    if (l.type==="symbol" && /^(label_(city|city_capital|state|country.*)|highway-shield.*|road_shield.*)$/.test(l.id)) m.setLayoutProperty(l.id,"visibility","none");
  }
}
function baseGroups(){
  const m=MAP.m;
  if (MAP.mode!=="tiles"){ MAP.groups=[]; MAP.src=null; return; }
  const st=m.getStyle();
  MAP.src=Object.entries(st.sources||{}).find(([k,v])=>v.type==="vector")?.[0]||null;
  for (const l of st.layers){ const f=l.layout&&l.layout["text-font"]; if(Array.isArray(f)&&typeof f[0]==="string"){ MAP.font=f[0]; break; } }
  MAP.groups=BASE_GROUPS.map(([k,label,color,re])=>({k,label,color,ids:st.layers.filter(l=>re.test(l.id)&&l.type!=="background").map(l=>l.id)})).filter(g=>g.ids.length);
  let saved={}; try { saved=JSON.parse(localStorage.getItem("sps-layers")||"{}"); } catch(e){}
  for (const g of MAP.groups) g.on=true; // 배경 이름 켜고 끄기 칩은 없앰

}
function loadLayerPrefs(){
  let saved={}; try { saved=JSON.parse(localStorage.getItem("sps-layers")||"{}"); } catch(e){}
  if (saved.rail===false) MAP.app.rail=false; // 철도망은 ‘노선’ 탭에서 켜고 끔. 나머지 지도 표시는 항상 켬
}
function addAppLayers(){
  const m=MAP.m, tiles=MAP.mode==="tiles", empty={type:"FeatureCollection",features:[]};
  addRailLayers(m);
  m.addSource("places",{type:"geojson",data:empty,cluster:tiles,clusterRadius:44,clusterMaxZoom:14,clusterProperties:{photos:["+",["get","ph"]]}});
  m.addSource("sun",{type:"geojson",data:empty});
  m.addLayer({id:"ast-solid",type:"line",source:"sun",filter:["==",["get","s"],"solid"],layout:{"line-cap":"round"},paint:{"line-width":4,"line-color":["get","c"],"line-opacity":.92}});
  m.addLayer({id:"ast-dash",type:"line",source:"sun",filter:["==",["get","s"],"dash"],paint:{"line-width":2.6,"line-dasharray":[2,1.4],"line-color":["get","c"]}});
  m.addLayer({id:"ast-dot",type:"line",source:"sun",filter:["==",["get","s"],"dot"],layout:{"line-cap":"round"},paint:{"line-width":2.2,"line-dasharray":[0.2,2],"line-color":["get","c"],"line-opacity":.8}});
  /* 장소 점·묶음은 화면에 그리지 않는 레이어로만 둠(묶음 계산과 데이터 타일을 위해 필요).
     실제로 보이는 마커는 아래 updateDomMarkers()가 디자인 시스템의 sp-marker / sp-cluster HTML로 그림 */
  const hide={"circle-opacity":0,"circle-stroke-opacity":0};
  if (tiles) m.addLayer({id:"cl",type:"circle",source:"places",filter:["has","point_count"],paint:{"circle-radius":1,...hide}});
  m.addLayer({id:"pt",type:"circle",source:"places",filter:["!",["has","point_count"]],paint:{"circle-radius":1,...hide}});
  m.addLayer({id:"pt-sel",type:"circle",source:"places",filter:["==",["get","id"],"__none"],paint:{"circle-radius":1,...hide}});
}
function bindAppHandlers(){
  const m=MAP.m;
  bindRailHandlers(m);
  // 지도가 움직이거나 묶음이 바뀔 때마다 보이는 HTML 마커를 맞춤(MapLibre ‘HTML 묶음 마커’ 방식)
  m.on("render",()=>{ if (m.getSource("places") && m.isSourceLoaded("places")) updateDomMarkers(); });
}
/* ---------- MapMarker: sp-marker(테마 3종 색+글리프, 사진 없음=속 빈 마커, 선택됨=44px+대표 사진) / sp-cluster(숫자) ---------- */
MAP.dom = new Map(); MAP.selMk = null;
function markerEl(pr){
  const th=MARKER_THEMES.includes(pr.th)?pr.th:"arch", el=document.createElement("button");
  el.type="button";
  el.className=`sp-marker sp-marker--${th}`+(pr.ph?"":" sp-marker--empty");
  el.setAttribute("aria-label",`${pr.name}, ${MARKER_THEME_NAME[th]}${pr.ph?"":", 사진 없음"}`);
  el.innerHTML=`<svg viewBox="0 0 24 24" aria-hidden="true">${MARKER_GLYPH[th]}</svg>`;
  el.addEventListener("click",e=>{ e.stopPropagation(); if (MAP.pick) return; select(pr.id,{from:"map"}); });
  if (!IS_PHONE){
    el.addEventListener("mouseenter",()=>{ if(pr.id===S.sel) return; MAP.hover?.remove(); MAP.hover=new maplibregl.Popup({closeButton:false,closeOnClick:false,offset:18}).setLngLat(el.__ll).setText(pr.name).addTo(MAP.m); });
    el.addEventListener("mouseleave",()=>{ MAP.hover?.remove(); MAP.hover=null; });
  }
  return el;
}
function clusterEl(pr, ll){
  const el=document.createElement("button"); el.type="button"; el.className="sp-cluster";
  el.textContent=pr.point_count_abbreviated; el.setAttribute("aria-label",`출사지 ${pr.point_count}곳 묶음. 눌러서 확대`);
  el.addEventListener("click",async e=>{
    e.stopPropagation(); if (MAP.pick) return;
    try { const z=await MAP.m.getSource("places").getClusterExpansionZoom(pr.cluster_id); MAP.m.easeTo({center:ll,zoom:Math.min(z,16)}); } catch(err){ MAP.m.easeTo({center:ll,zoom:MAP.m.getZoom()+2}); }
  });
  return el;
}
function updateDomMarkers(){
  const m=MAP.m; if (!m || MAP.state!=="ready" || !m.getSource("places")) return;
  const seen=new Set();
  for (const f of m.querySourceFeatures("places")){
    const pr=f.properties, ll=f.geometry.coordinates;
    const key=pr.cluster?`c${pr.cluster_id}`:`p${pr.id}`;
    if (seen.has(key)) continue; seen.add(key);
    if (!pr.cluster && pr.id===S.sel) continue;               // 선택된 곳은 아래에서 따로 그림(묶음 안에 있어도 보이게)
    if (MAP.dom.has(key)) continue;
    const el=pr.cluster?clusterEl(pr,ll):markerEl(pr); el.__ll=ll;
    MAP.dom.set(key,new maplibregl.Marker({element:el}).setLngLat(ll).addTo(m));
  }
  for (const [k,mk] of MAP.dom) if (!seen.has(k)){ mk.remove(); MAP.dom.delete(k); }
  syncSelMarker();
}
function syncSelMarker(){
  const p=S.sel&&getPlace(S.sel), want=p&&hasCoord(p)&&mapPlaces().some(x=>x.id===p.id)?p.id:null;
  if (MAP.selMk && MAP.selMk.__id===want) return;
  MAP.selMk?.remove(); MAP.selMk=null;
  if (!want || !MAP.m) return;
  const cv=coverOf(p.id), el=markerEl({id:p.id,name:p.name,th:markerThemeOf(p),ph:cv?1:0});
  el.classList.add("sp-marker--selected"); el.setAttribute("aria-current","true");
  if (cv) el.innerHTML=`<img data-ref="${esc(cv.thumbRef||cv.fullRef)}" alt="">`;
  el.__ll=[p.lng,p.lat];
  MAP.selMk=new maplibregl.Marker({element:el}).setLngLat([p.lng,p.lat]).addTo(MAP.m); MAP.selMk.__id=want;
  if (cv) hydrate(el);
}
function clearDomMarkers(){ for (const mk of MAP.dom.values()) mk.remove(); MAP.dom.clear(); MAP.selMk?.remove(); MAP.selMk=null; }
function afterLayers(){ renderLayerChips(); syncMarkers(); syncRail(); syncSunOnMap(); }
/* 지도 위 칩: 테마 · 계절(고르는 메뉴) · 사진 있는 곳(켜고 끄기). 목록 필터(S.f)와 같은 값을 씀 */
const LAYER_MENUS={theme:["테마",THEMES,()=>S.f.themes],season:["계절",SEASONS,()=>S.f.seasons],time:["추천 시간대",TIME_SLOTS,()=>S.f.times]};
MAP.menu=null;
function renderLayerChips(){
  const el=$("#layerChips"); if(!el) return;
  const menuBtn=k=>{ const [lab,,set]=LAYER_MENUS[k], n=set().size, on=n>0;
    return `<button type="button" data-lg="${k}" aria-haspopup="true" aria-expanded="${MAP.menu===k}" aria-pressed="${on}" class="lg-menu"><span>${esc(lab)}</span>${on?`<b class="num">${n}</b>`:""}<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg></button>`; };
  el.innerHTML = menuBtn("theme") + menuBtn("season") + menuBtn("time")
    + `<button type="button" data-lg="photo" aria-pressed="${S.f.photo}" style="--lc:var(--accent)"><i></i>사진 있는 곳</button>`;
  renderLayerMenu();
}
function renderLayerMenu(){
  const box=$("#layerMenu"); if(!box) return;
  const k=MAP.menu; if(!k){ box.hidden=true; box.innerHTML=""; return; }
  const [lab,items,set]=LAYER_MENUS[k], cur=set();
  box.innerHTML=`<div class="lm-head"><b>${esc(lab)}</b>${cur.size?`<button type="button" class="btn small ghost" data-lm="clear">전체 해제</button>`:""}</div>
    <div class="chips">${items.map(v=>`<button type="button" class="chip" data-lm="${esc(v)}" aria-pressed="${cur.has(v)}">${esc(v)}</button>`).join("")}</div>`;
  box.hidden=false;
  const btn=$("#layerChips").querySelector(`[data-lg="${k}"]`), pane=$("#mapPane");
  if (btn && pane){ const r=btn.getBoundingClientRect(), pr=pane.getBoundingClientRect(); box.style.left=Math.max(8,Math.min(r.left-pr.left, pr.width-box.offsetWidth-8))+"px"; box.style.top=(r.bottom-pr.top+6)+"px"; }
}
$("#layerMenu").addEventListener("click",e=>{
  e.stopPropagation();
  const b=e.target.closest("[data-lm]"); if(!b||!MAP.menu) return;
  const set=LAYER_MENUS[MAP.menu][2]();
  if (b.dataset.lm==="clear") set.clear(); else { const v=b.dataset.lm; set.has(v)?set.delete(v):set.add(v); }
  refreshResults();
});
document.addEventListener("click",e=>{ if(MAP.menu && !e.target.closest("#layerMenu") && !e.target.closest("#layerChips")){ MAP.menu=null; renderLayerChips(); } });
document.addEventListener("keydown",e=>{ if(e.key==="Escape" && MAP.menu){ const k=MAP.menu; MAP.menu=null; renderLayerChips(); $("#layerChips").querySelector(`[data-lg="${k}"]`)?.focus(); } });
function saveLayerPrefs(){ try { const o={photoOnly:MAP.app.photoOnly,sun:MAP.app.sun,moon:MAP.app.moon,rail:MAP.app.rail,places:MAP.app.places}; MAP.groups.forEach(g=>o[g.k]=g.on); localStorage.setItem("sps-layers",JSON.stringify(o)); } catch(e){} }
$("#layerChips").addEventListener("click",e=>{
  e.stopPropagation();
  const b=e.target.closest("[data-lg]"); if(!b) return;
  const k=b.dataset.lg;
  if (k==="photo"){ MAP.menu=null; S.f.photo=!S.f.photo; refreshResults(); return; }
  MAP.menu = MAP.menu===k ? null : k; renderLayerChips();
});
function mapPlaces(){ if (!MAP.app.places) return []; return visible().filter(hasCoord).filter(p=>!MAP.app.photoOnly||photosOf(p.id).length); }
function syncMarkers(){
  if (!MAP.m || MAP.state!=="ready") return;
  const src=MAP.m.getSource("places"); if(!src) return;
  src.setData({type:"FeatureCollection",features:mapPlaces().map(p=>({type:"Feature",geometry:{type:"Point",coordinates:[p.lng,p.lat]},properties:{id:p.id,name:p.name,ph:photosOf(p.id).length?1:0,th:markerThemeOf(p),mine:1}}))});
  MAP.m.setFilter("pt-sel",["==",["get","id"],S.sel||"__none"]);
  clearDomMarkers(); // 데이터(필터·사진·테마)가 바뀌었으니 HTML 마커를 새로 만듦. 다음 render 때 다시 그려짐
  showPopup();
}
function showPopup(){
  if (!MAP.m || MAP.state!=="ready") return;
  if (MAP.popup){ MAP.popup.remove(); MAP.popup=null; }
  // 선택이 바뀌면 일반 마커 목록도 다시 맞춤(선택된 곳은 큰 마커로 따로 그림)
  if (MAP.dom.has(`p${S.sel}`)){ MAP.dom.get(`p${S.sel}`).remove(); MAP.dom.delete(`p${S.sel}`); }
  updateDomMarkers();
  const p=S.sel&&getPlace(S.sel);
  if (!p||!hasCoord(p)) return;
  MAP.popup=new maplibregl.Popup({closeButton:false,closeOnClick:false,offset:34}).setLngLat([p.lng,p.lat]).setText(p.name).addTo(MAP.m);
}
function fitVisible(){
  if (!MAP.m || MAP.state!=="ready") return;
  const pts=mapPlaces(); if (!pts.length) return;
  if (pts.length===1){ MAP.m.jumpTo({center:[pts[0].lng,pts[0].lat],zoom:14}); return; }
  const b=new maplibregl.LngLatBounds(); pts.forEach(p=>b.extend([p.lng,p.lat]));
  MAP.m.fitBounds(b,{padding:{top:70,bottom:60,left:50,right:60},maxZoom:15,duration:0});
}
function focusOnMap(p){
  if (!MAP.m || MAP.state!=="ready" || !hasCoord(p)) return;
  const reduce=matchMedia("(prefers-reduced-motion: reduce)").matches;
  MAP.m.easeTo({center:[p.lng,p.lat],zoom:Math.max(MAP.m.getZoom(),15),duration:reduce?0:600});
}
/* 지도 위 방향선: 출몰 방향 = 굵은 실선, 선택 시각 방향 = 점선, 지평선 아래 = 흐린 점선. 기준점 = 관측 위치 */
function syncSunOnMap(){
  if (!MAP.m || MAP.state!=="ready" || MAP.restyling) return;
  MAP.sunMk.forEach(m=>m.remove()); MAP.sunMk=[];
  MAP.obsMk?.remove(); MAP.obsMk=null;
  const src=MAP.m.getSource("sun"); if(!src) return;
  const o=curObs();
  const showSun = MAP.app.sun && S.astroMode!=="moon", showMoon = MAP.app.moon && S.astroMode!=="sun";
  $("#lgSun").hidden = !(o&&showSun); $("#lgMoon").hidden = !(o&&showMoon); $("#lgNow").hidden = !(o&&(showSun||showMoon));
  if (!o || (!showSun && !showMoon)){ src.setData({type:"FeatureCollection",features:[]}); return; }
  const date=S.sun.date||today(), feats=[];
  const C={sun:cssVar("--sun"), moon:cssVar("--moon"), muted:cssVar("--ink-muted")}; // 해·달 선 색은 토큰(sun·moon)에서
  // 지도에는 짧은 이름표만 붙이고(일출·일몰·해·월출·월몰·달), 시각·방위·고도는 마우스를 올리면 보이는 설명과 왼쪽 해·달 카드에 둠
  const add=(deg,len,style,color,label,full,cls)=>{
    if (!isFinite(deg)) return;
    const end=destPoint(o.lat,o.lng,deg,len);
    feats.push({type:"Feature",geometry:{type:"LineString",coordinates:[[o.lng,o.lat],end]},properties:{s:style,c:color}});
    const el=document.createElement("span"); el.className="sunlbl"+(cls?" "+cls:""); el.style.color=color; el.textContent=label; el.title=full; el.setAttribute("aria-label",full);
    const mk=new maplibregl.Marker({element:el}).setLngLat(destPoint(o.lat,o.lng,deg,len*1.13)).addTo(MAP.m);
    mk.__ray={o,deg,len}; // 겹침 정리 때 선 위 다른 지점으로 옮길 수 있게 방향·길이를 기억
    MAP.sunMk.push(mk);
  };
  const t=sunDay(o,date), sm=selMin(t,date), when=atKst(date,sm);
  if (showSun){
    add(t.riseAz,900,"solid",C.sun,"일출",`일출 방위 ${Math.round(t.riseAz)}°`);
    add(t.setAz,900,"solid",C.sun,"일몰",`일몰 방위 ${Math.round(t.setAz)}°`);
    const pos=SC.getPosition(when,o.lat,o.lng), alt=pos.altitude*180/Math.PI, az=compass(pos.azimuth);
    if (alt>0) add(az,700,"dash",C.sun,`해 ${alt.toFixed(0)}°`,`${fmtT(when)} 해 고도 ${alt.toFixed(0)}° · 방위 ${Math.round(az)}°`);
    else add(az,500,"dot",C.muted,"해",`${fmtT(when)} 해는 지평선 아래`,"below");
  }
  if (showMoon){
    const r=MOON.riseSet(date,o.lat,o.lng);
    if (r.rise) add(r.riseAz,1200,"solid",C.moon,"월출",`월출 ${fmtT(r.rise)} · 방위 ${Math.round(r.riseAz)}°`,"moon");
    if (r.set) add(r.setAz,1200,"solid",C.moon,"월몰",`월몰 ${fmtT(r.set)} · 방위 ${Math.round(r.setAz)}°`,"moon");
    const p=MOON.position(when,o.lat,o.lng);
    if (p.alt>0) add(p.az,1000,"dash",C.moon,`달 ${p.alt.toFixed(0)}°`,`${fmtT(when)} 달 고도 ${p.alt.toFixed(0)}° · 방위 ${Math.round(p.az)}°`,"moon");
    else add(p.az,600,"dot",C.muted,"달",`${fmtT(when)} 달은 지평선 아래`,"moon below");
  }
  src.setData({type:"FeatureCollection",features:feats});
  // 관측 위치가 선택한 장소이면 장소 이름표가 이미 있으므로 ‘관측 위치’ 글자는 생략하고 고리만 표시
  const el=document.createElement("div"); el.className="obsmk"; el.innerHTML=o.kind==="place"?`<i></i>`:`<i></i><span>관측 위치</span>`;
  MAP.obsMk=new maplibregl.Marker({element:el,anchor:"top",offset:[0,-9]}).setLngLat([o.lng,o.lat]).addTo(MAP.m);
  if (!MAP.m.__sunDeclutter){ MAP.m.__sunDeclutter=true; MAP.m.on("moveend",declutterSunLabels); }
  requestAnimationFrame(declutterSunLabels);
}
/* 해·달 이름표 겹침 정리: 먼저 그린 이름표(일출·일몰 → 현재 해 → 달)를 우선 배치.
   선 끝이 화면 밖이거나 장소 이름표·다른 이름표와 겹치면 같은 선 위의 더 안쪽 지점으로 옮기고,
   어디에도 자리가 없으면 숨김. 선은 그대로 둠 */
function declutterSunLabels(){
  if (!MAP.m || !MAP.sunMk.length) return;
  const cont=MAP.m.getContainer(), box=cont.getBoundingClientRect(), pad=4, edge=8;
  // 지도 위 칩 줄·범례·전체 보기·도구 손잡이 자리도 피함
  const taken=[...cont.querySelectorAll(".maplibregl-popup-content")].map(e=>e.getBoundingClientRect())
    .concat([...document.querySelectorAll("#layerChips button,#legend,#fitBtn,#sheetHandle,.maplibregl-ctrl-group,.obsmk")].filter(e=>e.offsetParent).map(e=>e.getBoundingClientRect()));
  const hit=(a,b)=>a.left<b.right+pad&&a.right>b.left-pad&&a.top<b.bottom+pad&&a.bottom>b.top-pad;
  const inBox=r=>r.left>=box.left+edge&&r.right<=box.right-edge&&r.top>=box.top+edge&&r.bottom<=box.bottom-edge;
  const FR=[1.13,1,0.85,0.7,0.55,0.42,0.3];
  for (const mk of MAP.sunMk){
    const el=mk.getElement(), ray=mk.__ray; el.style.visibility="";
    let placed=false;
    for (const f of (ray?FR:[1.13])){
      if (ray) mk.setLngLat(destPoint(ray.o.lat,ray.o.lng,ray.deg,ray.len*f));
      const r=el.getBoundingClientRect();
      if (inBox(r) && !taken.some(t=>hit(r,t))){ taken.push(r); placed=true; break; }
    }
    if (!placed) el.style.visibility="hidden";
  }
}
function startPick(cb, text){
  if (!MAP.m || MAP.state!=="ready") return false;
  MAP.pick=cb; $("#pickBar").hidden=false; $("#pickText").textContent=text||"지도에서 위치를 눌러 주세요. 확대해서 정확히 고르세요.";
  document.body.classList.add("picking");
  MAP.m.getCanvas().style.cursor="crosshair";
  if (isMobile()) setView("map");
  setTimeout(()=>MAP.m&&MAP.m.resize(),60);
  return true;
}
function endPick(){ MAP.pick=null; $("#pickBar").hidden=true; document.body.classList.remove("picking"); if(MAP.m) MAP.m.getCanvas().style.cursor=""; }

/* =====================================================================
   8. 렌더링 — 목록, 상세(확인된 사실 / 재확인 필요 / 촬영 제안 / 미확인 구분), 해 시간
   ===================================================================== */
function srcLinks(list){ return (list||[]).filter(s=>safeUrl(s.u)).map((s,i,a)=>`<a href="${esc(safeUrl(s.u))}" target="_blank" rel="noopener" title="${esc(s.t||"")}">출처${a.length>1?i+1:""}</a>`).join(""); }
function metaBadge(p,k,showSug){
  if ((p.edited||[]).includes(k)) return ` <span class="badge mine">직접 입력</span>`;
  const m=p.fieldMeta?.[k]; if(!m) return "";
  // ‘촬영 제안’은 섹션 제목에 한 번만 표시하므로 줄마다 붙이지 않음(소개 문단처럼 섹션 밖에 있을 때만 표시)
  const kb={fact:`<span class="badge fact">확인된 사실</span>`,ref:`<span class="badge ref">재확인 필요</span>`,suggest:showSug?`<span class="badge sug">촬영 제안</span>`:""}[m.k]||"";
  const src=srcLinks(m.src);
  return ` ${kb}${src?`<span class="srcs">${src}</span>`:""}${m.at&&src?` <span class="meta">${esc(m.at)} 확인</span>`:""}`;
}
function lineDot(code){ const m=LINES[code]; return `<span class="dot" style="--lc:${m&&m.c?m.c:"var(--muted)"}" aria-hidden="true"></span>`; }
function lineName(code){ return LINES[code]?.n || code; }
function accText(a){ return [(a.lines||[]).map(lineName).join("·"), a.station, a.exit?`${a.exit} 출구`.replace(/출구 출구$/,"출구"):null, a.walk].filter(Boolean).join(" · "); }
function originBadge(p){ return ""; }
function unknownCell(p,k){
  // 공개 화면: ‘미확인’만 표시. 조사 메모(엑셀 DB 상태 등)·출처·조사일은 편집·점검 화면에서만 봄
  return `<span class="tag warn">미확인</span>`;
}
/* 값이 없는 칸은 한 줄씩 ‘미확인’을 늘어놓지 않고 miss 배열에 모아 섹션 끝에 한 줄로 보여 줌 */
function fieldRow(p,k,lab,miss){
  const v=getF(p,k), dim=p.review&&!(p.edited||[]).includes(k);
  if (isEmptyV(v)){ if(miss){ miss.push(lab); return ""; } return `<dt>${esc(lab)}</dt><dd>${unknownCell(p,k)}</dd>`; }
  const body=Array.isArray(v)?`<ul class="pts">${v.map(h=>`<li>${esc(h)}</li>`).join("")}</ul>`:esc(v);
  return `<dt>${esc(lab)}</dt><dd${dim?` class="stale"`:""}>${body}${metaBadge(p,k)}${dim?` <span class="badge warn">재확인 필요</span>`:""}</dd>`;
}
function missLine(miss){ return miss.length?`<p class="missline"><span class="tag warn">미확인 ${miss.length}</span> ${miss.map(esc).join(" · ")}</p>`:""; }
function officialRow(p,miss){
  const v=p.official, m=p.fieldMeta?.official;
  if (isEmptyV(v)){ if(miss){ miss.push("공식 안내"); return ""; } return `<dt>공식 안내</dt><dd>${unknownCell(p,"official")}</dd>`; }
  const u=safeUrl(v)|| (m?.src||[]).map(s=>safeUrl(s.u)).find(Boolean);
  return `<dt>공식 안내</dt><dd>${u?`<a href="${esc(u)}" target="_blank" rel="noopener">${esc(safeUrl(v)?u:v)}</a>`:esc(v)}${metaBadge(p,"official")}</dd>`;
}
function photoStateBadge(x){
  if (PUBLIC_MODE||S.previewing) return "";
  return x.public?`<span class="badge fact">공개 표시 · 공개 파일에 포함</span>`:`<span class="badge">비공개 · 이 브라우저에만 저장</span>`;
}
function renderDetail(){
  const p=S.sel&&getPlace(S.sel);
  $("#listView").hidden=!!p; $("#detailView").hidden=!p;
  if (!p){ return; }
  const w=S.store&&S.store.canWrite;
  const ph=photosOf(p.id); if (S.photoIdx>=ph.length) S.photoIdx=0;
  const cur=ph[S.photoIdx], L=mapLinks(p);
  const gallery = ph.length ? `<div class="gallery">
      <button type="button" class="main" data-act="zoom" aria-label="사진 크게 보기"><img data-ref="${esc(cur.fullRef)}" alt="${esc(cur.caption||p.name+" 사진")}" decoding="async"></button>
      <div class="cap">${esc(cur.caption||"캡션 없음")}${[cur.takenAt,cur.season,cur.time].filter(Boolean).length?" · "+esc([cur.takenAt,cur.season,cur.time].filter(Boolean).join(" · ")):""} <span class="num">(${S.photoIdx+1}/${ph.length})</span> ${photoStateBadge(cur)}</div>
      ${ph.length>1?`<div class="strip">${ph.map((x,i)=>`<button type="button" data-pi="${i}" aria-current="${i===S.photoIdx}" aria-label="${i+1}번째 사진"><img data-ref="${esc(x.thumbRef||x.fullRef)}" alt="" loading="lazy"></button>`).join("")}</div>`:""}
    </div>` : (w?`<div class="ph-mini"><span>아직 이 장소에 내 사진이 없어요.</span><button type="button" class="btn small" data-act="edit-this">사진 추가</button></div>`:"");

  // 가는 길: 조사한 지하철·출구 + 도보 참고 (아래 ‘가까운 역’ 계산과 한 섹션으로 합침)
  const acc=(p.access||[]).filter(a=>a.station||(a.lines||[]).length);
  const missWay=[];
  const accRow = acc.length ? `<dt>지하철·출구</dt><dd>${acc.map(a=>`<div>${(a.lines||[]).map(lineDot).join("")} ${esc(accText(a))}</div>`).join("")}${metaBadge(p,"access")}</dd>` : (missWay.push("지하철·출구"),"");
  const wayRows = accRow + fieldRow(p,"notes.walk","도보 참고",missWay) + fieldRow(p,"notes.entrance","출입구·접근",missWay);
  // 촬영 정보: 요약 카드(구도·초점거리·시간대) + 나머지 제안
  const SUMMARY_KEYS=[["composition","구도"],["focal","초점거리"],["bestTime","시간대"]];
  const sumRows=SUMMARY_KEYS.filter(([k])=>!isEmptyV(getF(p,k))).map(([k,l])=>{ const v=getF(p,k); return `<div class="sumrow"><span class="k">${l}</span><span class="v">${esc(Array.isArray(v)?v.join(", "):String(v).replace(/^추천 조건:\s*/,""))}${metaBadge(p,k)}</span></div>`; }).join("");
  const missShoot=[];
  const shootRows=SHOOT_FIELDS.filter(([k])=>!SUMMARY_KEYS.some(s=>s[0]===k)).map(([k,l])=>fieldRow(p,k,l,missShoot)).join("")+fieldRow(p,"seasons","계절",missShoot)+fieldRow(p,"themes","테마",missShoot);
  const slots=timeSlotsOf(p);
  // 방문 정보: 값이 있는 칸만 표, 없는 칸은 끝에 한 줄
  const missVisit=[];
  const visitRows=VISIT_FIELDS.filter(([k])=>!["notes.entrance","notes.walk"].includes(k)).map(([k,l])=>fieldRow(p,k,l,missVisit)).join("")+fieldRow(p,"nightFact","야간 개방",missVisit)+officialRow(p,missVisit);
  const hasRef=/badge (fact|ref)/.test(visitRows+wayRows);
  const srcAll=new Map(); for (const m of Object.values(p.fieldMeta||{})) for (const s of m.src||[]) if(safeUrl(s.u)&&!srcAll.has(s.u)) srcAll.set(s.u,s);
  const checked=[...new Set(Object.values(p.fieldMeta||{}).map(m=>m.at).filter(Boolean))].sort().pop();
  const nv=p.naver;
  const records=[];
  if (p.memo) records.push(`<dt>메모</dt><dd>${esc(p.memo)}${!PUBLIC_MODE&&!S.previewing?` <span class="badge">${p.memoPublic?"공개":"비공개"}</span>`:""}</dd>`);
  if ((p.visits||[]).length) records.push(`<dt>방문 기록</dt><dd>${p.visits.map(v=>`<div><span class="mono">${esc(v.date||"날짜 미입력")}</span> ${esc(v.note||"")}${!PUBLIC_MODE&&!S.previewing?` <span class="badge">${v.public?"공개":"비공개"}</span>`:""}</div>`).join("")}</dd>`);

  $("#detailBody").innerHTML = `
    ${gallery}
    <div class="dhead">
      <div class="tags">${(p.tags||[]).map(t=>`<span class="tag">${esc(t)}</span>`).join("")}${!hasCoord(p)?`<span class="tag warn">위치 확인 필요</span>`:""}${regionOf(p)==="outside"?`<span class="tag warn">서울 외</span>`:""}</div>
      <h2>${esc(p.name)}</h2>
      <div class="addr">${p.address?esc(p.address):`<span class="tag warn">주소 확인 필요</span>`}</div>
      ${p.intro?`<p class="prose">${esc(p.intro)}${metaBadge(p,"intro",true)}</p>`:""}
    </div>
    ${p.review?`<div class="warnbox" style="margin:10px 16px 0"><b>재확인 필요.</b> ${esc(p.review.reason||"장소 정보가 크게 바뀌었어요.")} 아래의 조사 정보는 이전 장소 기준일 수 있어요.${w?` <button type="button" class="btn small" data-act="review-done">재확인 완료</button>`:""}</div>`:""}
    <div class="actions maplinks">
      <a class="btn small" href="${esc(L.naverWeb)}" target="_blank" rel="noopener">네이버 지도</a>
      <a class="btn small" href="${esc(L.kakao)}" target="_blank" rel="noopener">카카오맵</a>
      <a class="btn small" href="${esc(L.google)}" target="_blank" rel="noopener">구글 지도</a>
      <button type="button" class="btn small primary" data-act="route">길찾기</button>
      <button type="button" class="btn small" data-act="copy" data-text="${esc(p.address||p.name)}">주소 복사</button>
      ${hasCoord(p)?`<button type="button" class="btn small coordbtn" data-act="copy" data-text="${p.lat.toFixed(6)}, ${p.lng.toFixed(6)}" title="좌표 복사">좌표 복사</button>`:""}
    </div>
    ${records.length?`<section class="dsec" aria-label="내 기록"><h3>내 기록</h3><dl class="kv">${records.join("")}</dl></section>`:""}
    <section class="dsec" aria-label="촬영 정보">
      <h3>촬영 정보 <span class="badge sug">제안 · 공식 안내 아님</span></h3>
      ${sumRows?`<div class="shootsum">${sumRows}${slots.length?`<div class="slotchips">${slots.map(s=>`<span class="slot">${esc(s)}</span>`).join("")}</div>`:""}</div>`:""}
      ${shootRows?`<dl class="kv">${shootRows}</dl>`:""}
      ${missLine(missShoot)}
      <p class="fine">장소 유형과 일반적인 촬영 경험을 바탕으로 한 추천이에요. 대표 좌표만으로는 실제 조망이나 건물·지형 가림을 알 수 없어요. 개화·단풍 시기는 해마다 달라요.</p>
    </section>
    ${hasCoord(p) ? astroSection(placeObs(p),"place") : `<section class="dsec" aria-label="해·달"><h3>해·달</h3><p class="fine">좌표가 없어 계산할 수 없어요. 편집에서 위치를 지정하면 계산돼요.</p></section>`}
    ${nearHTML(p, wayRows, missWay)}
    <section class="dsec" aria-label="방문 정보">
      <h3>방문 정보</h3>
      ${hasRef?`<div class="legendline"><span class="badge fact">확인된 사실</span><span class="badge ref">재확인 필요</span><span class="meta">표시는 조사 근거 수준이에요</span></div>`:""}
      ${visitRows?`<dl class="kv">${visitRows}</dl>`:""}
      ${missLine(missVisit)}
      <p class="fine">이 정보는 ${esc(checked||"제작 시점")}에 조사해 파일에 넣은 값이에요. 사이트가 자동으로 최신화하지 않으니 방문 전 공식 안내를 다시 확인하세요.</p>
    </section>
    <section class="dsec" aria-label="원본과 출처">
      <h3>원본·출처</h3>
      <dl class="kv">
        ${nv&&!PUBLIC_MODE&&!S.previewing?`<dt>JSON 원본</dt><dd>이름 ${esc(nv.name||"")} · 주소 ${esc(nv.address||"")}<br><span class="mono">sid ${esc(nv.sid||"-")} · bookmarkId ${esc(nv.bookmarkId??"-")}</span><br><span class="fine">분류 ${esc(nv.mcidName||"-")}. 북마크 시각·available·isIndoor는 사실 판단에 쓰지 않았어요.</span></dd>`:""}
        ${(p.edited||[]).length&&!PUBLIC_MODE&&!S.previewing?`<dt>직접 수정</dt><dd>${esc(p.edited.map(k=>FIELD_LABEL[k]||k).join(", "))}</dd>`:""}
        ${checked?`<dt>조사일</dt><dd class="num">${esc(checked)}</dd>`:""}
        ${srcAll.size?`<dt>출처</dt><dd>${[...srcAll.values()].map(s=>`<a href="${esc(safeUrl(s.u))}" target="_blank" rel="noopener">${esc(s.t||s.u)}</a>`).join("<br>")}</dd>`:""}
      </dl>
    </section>
    <div style="height:28px"></div>`;
  hydrate($("#detailBody"));
  // 스크롤해서 장소 이름(h2)이 가려지면 위쪽 고정 줄에 이름을 보여 줌
  $("#dTitle").textContent=p.name;
  const h2=$("#detailBody .dhead h2"), bar=$("#detailView .dtop");
  MAP.dObs?.disconnect(); bar.classList.remove("scrolled");
  if (h2 && "IntersectionObserver" in window){ MAP.dObs=new IntersectionObserver(([e])=>bar.classList.toggle("scrolled",!e.isIntersecting&&e.boundingClientRect.top<(e.rootBounds?e.rootBounds.top:0)+60),{root:$("#side"),rootMargin:"-56px 0px 0px 0px",threshold:0}); MAP.dObs.observe(h2); }
}

function renderChips(){
  const mk=(el,items,set,labelFn,dotFn)=>{ el.innerHTML=items.map(v=>`<button type="button" class="chip" data-v="${esc(v)}" aria-pressed="${set.has(v)}">${dotFn?dotFn(v):""}${esc(labelFn?labelFn(v):v)}</button>`).join(""); };
  mk($("#chipsSeason"),SEASONS,S.f.seasons);
  mk($("#chipsTheme"),THEMES,S.f.themes);
  mk($("#chipsTime"),TIME_SLOTS,S.f.times);
  const tagSet=new Set(); S.places.forEach(p=>(p.tags||[]).forEach(t=>tagSet.add(t))); S.f.tags.forEach(t=>tagSet.add(t));
  const tags=TAG_ORDER.filter(t=>tagSet.has(t)).concat([...tagSet].filter(t=>!TAG_ORDER.includes(t)).sort((a,b)=>a.localeCompare(b,"ko")));
  mk($("#chipsTag"),tags,S.f.tags);
  $("#chipsTag").closest(".fgroup").hidden=!tags.length;
  const used=new Set(); S.places.forEach(p=>(p.access||[]).forEach(a=>(a.lines||[]).forEach(l=>used.add(l)))); S.f.lines.forEach(l=>used.add(l));
  const lines=LINE_ORDER.filter(l=>used.has(l)).concat([...used].filter(l=>!LINES[l]));
  mk($("#chipsLine"),lines,S.f.lines,lineName,lineDot);
  $("#chipsLine").closest(".fgroup").hidden=!lines.length;
  $("#chipsKind").innerHTML=KINDS.map(([k,l])=>{ const n=S.places.filter(p=>kindMatch(p,k)).length; return n||S.f.kinds.has(k) ? `<button type="button" class="chip" data-v="${k}" aria-pressed="${S.f.kinds.has(k)}">${esc(l)} <span class="n num">${n}</span></button>` : ""; }).join("");
  const nph=S.places.filter(p=>photosOf(p.id).length).length;
  $("#photoOnly").setAttribute("aria-pressed",String(S.f.photo)); $("#photoOnly").textContent=`● 사진 있는 곳 ${nph}`;
}
function renderSummary(n){
  const c=S.f.seasons.size+S.f.themes.size+S.f.times.size+S.f.tags.size+S.f.lines.size+S.f.kinds.size+(S.f.photo?1:0)+(S.f.q.trim()?1:0);
  const w=S.store&&S.store.canWrite;
  $("#summary").innerHTML=`<span><strong class="num">${n}곳</strong> / ${S.places.length}곳</span>${c?`<button type="button" class="btn small ghost" data-act="reset">필터 초기화</button>`:""}<span class="grow"></span>${w?`<button type="button" class="btn small" data-act="sel-mode" aria-pressed="${S.selMode}">${S.selMode?"선택 끝내기":"여러 곳 선택"}</button>`:""}`;
  $("#filterToggle").textContent = c ? `필터 ${c}` : "필터";
  const bb=$("#bulkBar");
  bb.hidden=!S.selMode;
  if (S.selMode) bb.innerHTML=`<span><b class="num">${S.selSet.size}</b>곳 선택</span><button type="button" class="btn small" data-act="sel-all">보이는 곳 전체</button><button type="button" class="btn small" data-act="sel-none">해제</button><button type="button" class="btn small" data-act="bulk-edit" ${S.selSet.size?"":"disabled"}>계절·테마·태그 편집</button>`;
}
function renderList(list){
  const el=$("#listPane");
  if (!S.places.length){ el.innerHTML=`<div class="empty"><strong>등록된 장소가 없어요</strong><span>새 JSON 버튼에서 네이버 지도 JSON을 올려 주세요.</span></div>`; return; }
  if (!list.length){ el.innerHTML=`<div class="empty"><strong>조건에 맞는 장소가 없어요</strong><span>같은 줄 안의 선택은 ‘또는’, 다른 줄끼리는 ‘그리고’로 적용돼요.</span><button type="button" class="btn primary" data-act="reset">필터 초기화</button></div>`; return; }
  el.innerHTML=`<ul class="cards">${list.map(p=>{
    const cv=coverOf(p.id), n=photosOf(p.id).length, a=(p.access||[]).find(x=>x.station);
    const sub=[p.district||(p.address?p.address.split(" ").slice(1,2).join(""):""), (p.tags||[])[0], a?a.station:null].filter(Boolean).join(" · ");
    const warn=[!hasCoord(p)?`<span class="tag warn">위치 확인 필요</span>`:"", regionOf(p)==="outside"?`<span class="tag warn">서울 외</span>`:""].join("");
    return `<li><button type="button" class="card${S.selMode?" sel-mode":""}" data-pid="${esc(p.id)}" aria-current="${S.sel===p.id}">
      ${S.selMode?`<input type="checkbox" tabindex="-1" ${S.selSet.has(p.id)?"checked":""} aria-label="${esc(p.name)} 선택">`:""}
      <span class="thumb${n?" has":""}">${cv?`<img data-ref="${esc(cv.thumbRef||cv.fullRef)}" alt="" loading="lazy" decoding="async">`:"사진<br>없음"}</span>
      <span style="min-width:0">
        <h3>${esc(p.name)}</h3>
        <span class="sub">${esc(sub||"지역 미확인")}</span>
        <span class="tags">${n?`<span class="tag ph">사진 ${n}</span>`:""}${(p.seasons||[]).map(s=>`<span class="tag">${esc(s)}</span>`).join("")}${(p.themes||[]).slice(0,3).map(t=>`<span class="tag">${esc(t)}</span>`).join("")}${warn}${p.review?`<span class="tag warn">재확인 필요</span>`:""}</span>
      </span></button></li>`;}).join("")}</ul>`;
  hydrate(el);
}

function sunHTML(p){
  if (!hasCoord(p)) return `<h3>해 시간</h3><p class="fine">좌표가 없어 계산할 수 없어요. 편집에서 위치를 지정하면 계산돼요.</p>`;
  const date=S.sun.date||today(), t=sunDay(p,date), sm=selMin(t,date);
  const pc=d=>(kstMin(d)/1440*100).toFixed(2);
  const seg=(a,b,c)=>`<span style="left:${pc(a)}%;width:${Math.max(0,pc(b)-pc(a)).toFixed(2)}%;background:${c}"></span>`;
  const yr=+date.slice(0,4), mo=+date.slice(5,7);
  const rowsM=Array.from({length:12},(_,i)=>{ const ds=`${yr}-${String(i+1).padStart(2,"0")}-15`, x=sunDay(p,ds); return `<tr class="${i+1===mo?"cur":""}"><td>${i+1}월 15일</td><td class="r">${fmtT(x.sunrise)}</td><td class="s">${fmtT(x.sunset)}</td><td>${fmtT(x.goldStartE)}</td><td>${Math.round(x.setAz)}°</td><td>${dur(x.dayMin)}</td></tr>`; }).join("");
  return `<h3>해 시간</h3>
    <div class="sunctl"><label class="sr" for="sunDate">날짜</label><input type="date" id="sunDate" value="${date}"><button type="button" class="btn small" data-act="sun-today">오늘</button><span class="fine">한국 표준시(Asia/Seoul)</span></div>
    <div class="suncards">
      <div class="sc"><div class="k">일출</div><div class="v rise">${fmtT(t.sunrise)}</div><div class="s">${isFinite(t.riseAz)?`방위 ${Math.round(t.riseAz)}° ${dirName(t.riseAz)}`:"이 날 일출 없음"}</div></div>
      <div class="sc"><div class="k">일몰</div><div class="v set">${fmtT(t.sunset)}</div><div class="s">${isFinite(t.setAz)?`방위 ${Math.round(t.setAz)}° ${dirName(t.setAz)}`:"이 날 일몰 없음"}</div></div>
      <div class="sc"><div class="k">아침 골든아워</div><div class="v sm">${fmtT(t.blueEndM)}–${fmtT(t.goldEndM)}</div><div class="s">블루아워 ${fmtT(t.dawn)}–${fmtT(t.blueEndM)}</div></div>
      <div class="sc"><div class="k">저녁 골든아워</div><div class="v sm">${fmtT(t.goldStartE)}–${fmtT(t.blueStartE)}</div><div class="s">블루아워 ${fmtT(t.blueStartE)}–${fmtT(t.dusk)}</div></div>
    </div>
    <div class="daybar" aria-hidden="true">${seg(t.dawn,t.blueEndM,"var(--moon)")}${seg(t.blueEndM,t.goldEndM,"var(--sun)")}${seg(t.goldEndM,t.goldStartE,"var(--accent-soft)")}${seg(t.goldStartE,t.blueStartE,"var(--sun)")}${seg(t.blueStartE,t.dusk,"var(--moon)")}<span class="now" id="sunNow" style="left:${(sm/1440*100).toFixed(2)}%"></span></div>
    <div class="ticks"><span>00</span><span>06</span><span>12</span><span>18</span><span>24</span></div>
    <div class="timerow"><label for="sunMin">시각</label><input type="range" id="sunMin" min="0" max="1435" step="5" value="${sm}"><span class="mono" id="sunT">${fmtT(atKst(date,sm))}</span></div>
    <div class="sunpos" id="sunPos">${sunPosText(p,date,sm)}</div>
    <p class="fine">낮 길이 ${dur(t.dayMin)} · 태양 남중 ${fmtT(t.solarNoon)}</p>
    <details><summary class="fine" style="cursor:pointer">월별 비교 (${yr}년 각 달 15일 기준)</summary>
      <table class="season"><thead><tr><th>기준일</th><th>일출</th><th>일몰</th><th>저녁 골든</th><th>일몰 방위</th><th>낮 길이</th></tr></thead><tbody>${rowsM}</tbody></table>
    </details>
    <p class="fine">계산 기준: 일출·일몰은 태양 윗가장자리가 지평선(고도 −0.833°)에 닿는 시각, 골든아워는 태양 고도 −4°~+6°, 블루아워는 −6°~−4°예요. 방위각은 정북 0°에서 시계방향이며 지도의 위쪽(북)과 같은 기준이에요. 건물·산·지형·구름 가림과 날씨는 반영하지 않은 천문 계산값이라 실제 빛을 보장하지 않아요.</p>`;
}
function sunPosText(p,date,min){
  const pos=SC.getPosition(atKst(date,min),p.lat,p.lng), alt=pos.altitude*180/Math.PI, az=compass(pos.azimuth);
  return alt>0 ? `${fmtT(atKst(date,min))} 태양 고도 <b class="num">${alt.toFixed(1)}°</b> · 방위 <b class="num">${Math.round(az)}°</b> (${dirName(az)})` : `${fmtT(atKst(date,min))} 해가 지평선 아래 (고도 ${alt.toFixed(1)}°)`;
}
const LAZY = "IntersectionObserver" in window ? new IntersectionObserver(es=>{ for (const e of es) if (e.isIntersecting){ LAZY.unobserve(e.target); loadImg(e.target); } },{rootMargin:"300px 0px"}) : null;
async function loadImg(img){
  const ref=img.dataset.ref;
  try { const u=await S.store?.url(ref); if(u) img.src=u; else img.replaceWith(missingImg()); } catch(e){ img.replaceWith(missingImg()); }
}
/* 사진은 화면에 보일 때만 불러옴. 끌어서 저장하지 못하게 draggable=false */
function hydrate(root){
  root.querySelectorAll("img[data-ref]").forEach(img=>{
    const ref=img.dataset.ref; if(!ref||img.dataset.done) return; img.dataset.done="1";
    img.draggable=false; if(!img.hasAttribute("loading")) img.loading="lazy";
    img.addEventListener("error",()=>img.replaceWith(missingImg()),{once:true});
    if (LAZY && !img.closest(".lightbox,.mapcard,.sp-marker")) LAZY.observe(img); else loadImg(img);
  });
}
function missingImg(){ const s=document.createElement("span"); s.className="fine"; s.style.cssText="color:var(--viewer-muted);padding:10px;display:block;text-align:center"; s.textContent="사진을 불러오지 못했어요"; return s; }
function refreshResults(){ const list=visible(); renderChips(); renderSummary(list.length); renderList(list); syncMarkers(); renderLayerChips(); }
function renderAll(){ refreshResults(); renderDetail(); syncSunOnMap(); renderSheet(); }

/* =====================================================================
   9. 상호작용
   ===================================================================== */
function select(id, opts={}){
  if (S.selMode && opts.from==="card"){ S.selSet.has(id)?S.selSet.delete(id):S.selSet.add(id); refreshResults(); return; }
  S.sel=id; S.photoIdx=0; S.obsCustom=null; if(isMobile()&&opts.from==="check") setView("list");
  const p=getPlace(id);
  document.querySelectorAll(".card").forEach(c=>c.setAttribute("aria-current", String(c.dataset.pid===id)));
  if (MAP.m && MAP.state==="ready") MAP.m.setFilter("pt-sel",["==",["get","id"],id||"__none"]);
  showPopup(); syncSunOnMap();
  if (opts.from!=="map" && p) focusOnMap(p);
  if (S.sheetTab==="astro") renderSheet();
  if (isMobile() && opts.from==="map"){ showMapCard(p); if (S.sheetOpen){ S.sheetOpen=false; renderSheet(); } }
  else { renderDetail(); $("#side").scrollTop=0; }
}
function closeDetail(){ S.sel=null; renderDetail(); hideMapCard(); renderSheet(); if(MAP.m&&MAP.state==="ready") MAP.m.setFilter("pt-sel",["==",["get","id"],"__none"]); showPopup(); syncSunOnMap(); refreshResults(); }
function showMapCard(p){
  const el=$("#mapCard"), cv=coverOf(p.id), a=(p.access||[]).find(x=>x.station);
  el.innerHTML=`<span class="thumb${cv?" has":""}">${cv?`<img data-ref="${esc(cv.thumbRef||cv.fullRef)}" alt="">`:"사진<br>없음"}</span><div class="t"><h3>${esc(p.name)}</h3><span class="meta">${esc([p.district,a?.station].filter(Boolean).join(" · "))}</span></div><button type="button" class="btn small primary" data-act="open-detail">상세</button><button type="button" class="btn small ghost" data-act="close-card" aria-label="닫기">✕</button>`;
  el.hidden=false; hydrate(el);
}
function hideMapCard(){ $("#mapCard").hidden=true; }
function resetFilters(){ S.f.q=""; $("#q").value=""; S.f.seasons.clear(); S.f.themes.clear(); S.f.times.clear(); S.f.tags.clear(); S.f.lines.clear(); S.f.kinds.clear(); S.f.photo=false; refreshResults(); }
function setView(v){
  S.view=v; document.body.dataset.view=v;
  $("#tabList").setAttribute("aria-selected", String(v==="list")); $("#tabMap").setAttribute("aria-selected", String(v==="map"));
  if (v==="map" && MAP.m) requestAnimationFrame(()=>MAP.m&&MAP.m.resize());
  if (v==="list") hideMapCard();
}
let qTimer;
$("#q").addEventListener("input",e=>{ clearTimeout(qTimer); qTimer=setTimeout(()=>{ S.f.q=e.target.value; if(S.sel) closeDetail(); else refreshResults(); },150); });
$("#filters").addEventListener("click",e=>{
  if (e.target.closest("#photoOnly")){ S.f.photo=!S.f.photo; refreshResults(); return; }
  if (e.target.closest("#filterToggle")){ const f=$("#filters"); f.classList.toggle("open"); $("#filterToggle").setAttribute("aria-expanded", String(f.classList.contains("open"))); return; }
  const b=e.target.closest(".chip[data-v]"); if(!b) return;
  const grp=b.parentElement.id;
  const set={chipsSeason:S.f.seasons,chipsTheme:S.f.themes,chipsTime:S.f.times,chipsTag:S.f.tags,chipsLine:S.f.lines,chipsKind:S.f.kinds}[grp]; if(!set) return;
  const v=b.dataset.v; set.has(v)?set.delete(v):set.add(v); refreshResults();
});
$("#backBtn").addEventListener("click",closeDetail);
$("#toMapBtn").addEventListener("click",()=>{ const p=getPlace(S.sel); setView("map"); setTimeout(()=>{ if(p) focusOnMap(p); if(MAP.state!=="ready") toast("지도가 아직 표시되지 않았어요",true); },80); });
$("#fitBtn").addEventListener("click",()=>fitVisible());
$("#legendBtn").addEventListener("click",()=>{ const l=$("#legend"), o=!l.classList.contains("open"); l.classList.toggle("open",o); $("#legendBtn").setAttribute("aria-expanded",String(o)); });
$("#tabList").addEventListener("click",()=>setView("list"));
$("#tabMap").addEventListener("click",()=>setView("map"));
matchMedia("(max-width:899px)").addEventListener("change",()=>{ hideMapCard(); MAP.m&&MAP.m.resize(); });

let sunRaf=0;
document.addEventListener("input",e=>{
  if (e.target.id==="sunMin"){
    const p=getPlace(S.sel); if(!p) return; S.sun.min=+e.target.value; const date=S.sun.date||today();
    $("#sunT").textContent=fmtT(atKst(date,S.sun.min)); $("#sunPos").innerHTML=sunPosText(p,date,S.sun.min); $("#sunNow").style.left=(S.sun.min/1440*100).toFixed(2)+"%";
    cancelAnimationFrame(sunRaf); sunRaf=requestAnimationFrame(syncSunOnMap);
  }
});
document.addEventListener("change",e=>{
  if (e.target.id==="sunDate" && /^\d{4}-\d{2}-\d{2}$/.test(e.target.value)){ S.sun.date=e.target.value; S.sun.min=null; rerenderSun(); }
});
function rerenderSun(){ rerenderAstro(); }

document.addEventListener("click",async e=>{
  const card=e.target.closest(".card[data-pid]");
  if (card){ select(card.dataset.pid,{from:"card"}); return; }
  const pi=e.target.closest("[data-pi]"); if(pi&&pi.closest("#detailBody")){ S.photoIdx=+pi.dataset.pi; renderDetail(); return; }
  const t=e.target.closest("[data-act]"); if(!t) return;
  const a=t.dataset.act, p=getPlace(S.sel);
  if (a==="reset") resetFilters();
  else if (a==="zoom") openLightbox(S.sel, S.photoIdx);
  else if (a==="copy") copyText(t.dataset.text);
  else if (a==="route" && p) openRoute(p);
  else if (a==="map-retry") initMap();
  else if (a==="pick-cancel"){ endPick(); }
  else if (a==="sun-today"){ S.sun.date=today(); S.sun.min=null; rerenderSun(); }
  else if (a==="open-detail"){ hideMapCard(); setView("list"); renderDetail(); $("#side").scrollTop=0; }
  else if (a==="close-card"){ closeDetail(); }
  else if (a==="sel-mode"){ S.selMode=!S.selMode; if(!S.selMode) S.selSet.clear(); refreshResults(); }
  else if (a==="sel-all"){ visible().forEach(x=>S.selSet.add(x.id)); refreshResults(); }
  else if (a==="sel-none"){ S.selSet.clear(); refreshResults(); }
});

async function copyText(t){
  try { await navigator.clipboard.writeText(t); toast(`“${t}” 복사했어요`); }
  catch(e){ toast(`복사가 막혀 있어요. 직접 복사하세요: ${t}`); }
}
let toastT;
function toast(msg, err, action){
  const el=$("#toast"); el.className="toast"+(err?" err":""); el.innerHTML=`<span>${esc(msg)}</span>`;
  if (action){ const b=document.createElement("button"); b.type="button"; b.textContent=action.label; b.addEventListener("click",()=>{ el.hidden=true; action.fn(); }); el.appendChild(b); }
  el.hidden=false; clearTimeout(toastT); toastT=setTimeout(()=>el.hidden=true, action?9000:err?6000:2800);
}

/* =====================================================================
   10. 사진 크게 보기 (이전·다음·삭제)
   ===================================================================== */
let lbState=null, lastFocus=null;
function openLightbox(pid, idx){
  if(!photosOf(pid).length) return;
  lastFocus=document.activeElement; lbState={pid,idx,confirm:false};
  const root=$("#overlayRoot");
  const draw=()=>{ const ph=photosOf(pid); if(!ph.length){ close(); return; } if(lbState.idx>=ph.length) lbState.idx=ph.length-1; const x=ph[lbState.idx], w=S.store&&S.store.canWrite;
    root.innerHTML=`<div class="lightbox" role="dialog" aria-modal="true" aria-label="사진 크게 보기">
      <div class="lb-top"><span class="count num">${lbState.idx+1} / ${ph.length}</span>
        ${ph.length>1?`<button class="lb-btn" type="button" data-lb="prev" aria-label="이전 사진">‹</button><button class="lb-btn" type="button" data-lb="next" aria-label="다음 사진">›</button>`:""}
        ${w?(lbState.confirm?`<button class="lb-btn del" type="button" data-lb="del-yes">정말 삭제</button><button class="lb-btn" type="button" data-lb="del-no">취소</button>`:`<button class="lb-btn del" type="button" data-lb="del">삭제</button>`):""}
        <button class="lb-btn" type="button" data-lb="close">닫기</button></div>
      <div class="lb-stage"><img data-ref="${esc(x.fullRef)}" alt="${esc(x.caption||"사진")}"></div>
      <div class="lb-cap"><strong>${esc(x.caption||"캡션 없음")}</strong><span>${esc([getPlace(pid)?.name,x.takenAt,x.season,x.time,x.shot].filter(Boolean).join(" · "))}</span>${x.note?`<span>메모: ${esc(x.note)}</span>`:""}</div></div>`;
    hydrate(root); root.querySelector('[data-lb="close"]').focus();
  };
  const move=d=>{ const n=photosOf(pid).length; lbState.idx=(lbState.idx+d+n)%n; lbState.confirm=false; draw(); };
  const onKey=e=>{ if(!lbState) return; if(e.key==="Escape") close(); else if(e.key==="ArrowRight") move(1); else if(e.key==="ArrowLeft") move(-1); };
  const onClick=async e=>{ const b=e.target.closest("[data-lb]"); if(!b) return; const k=b.dataset.lb;
    if (k==="close") close(); else if (k==="prev") move(-1); else if (k==="next") move(1);
    else if (k==="del"){ lbState.confirm=true; draw(); } else if (k==="del-no"){ lbState.confirm=false; draw(); }
    else if (k==="del-yes"){ const ph=photosOf(pid)[lbState.idx], st=S.stored.photos.find(x=>x.id===ph.id);
      try { await S.store.deletePhoto(st); S.stored.photos=S.stored.photos.filter(x=>x!==st); mergePlaces(); toast("사진을 삭제했어요"); } catch(err){ toast(`삭제하지 못했어요 (${err.code||err.message})`,true); }
      lbState.confirm=false; renderAll(); draw(); } };
  let sx=null; const ts=e=>{sx=e.touches[0].clientX}, te=e=>{ if(sx===null) return; const dx=e.changedTouches[0].clientX-sx; if(Math.abs(dx)>50) move(dx<0?1:-1); sx=null; };
  function close(){ lbState=null; root.innerHTML=""; document.removeEventListener("keydown",onKey); root.removeEventListener("click",onClick); root.removeEventListener("touchstart",ts); root.removeEventListener("touchend",te); lastFocus?.focus?.(); }
  document.addEventListener("keydown",onKey); root.addEventListener("click",onClick); root.addEventListener("touchstart",ts,{passive:true}); root.addEventListener("touchend",te);
  draw();
}

/* =====================================================================
   11. 길찾기 — 외부 지도 앱/웹을 여는 것. 소요시간·환승은 앱에서 계산하지 않음
   ===================================================================== */
function openRoute(p){
  lastFocus=document.activeElement;
  const st={mode:"transit", origin:"none", text:"", here:null, msg:""};
  const root=$("#overlayRoot");
  const draw=()=>{
    const o = st.origin==="here"&&st.here ? {lat:+st.here.lat.toFixed(6),lng:+st.here.lng.toFixed(6),name:"현재 위치"} : st.origin==="text"&&st.text.trim() ? {text:st.text.trim()} : null;
    const R=routeLinks(p,st.mode,o);
    root.innerHTML=`<div class="overlay" role="dialog" aria-modal="true" aria-labelledby="rtT"><div class="panel narrow">
      <div class="panel-head"><h2 id="rtT">길찾기 · ${esc(p.name)}</h2><button type="button" class="btn small" data-rt="close">닫기</button></div>
      <div class="panel-body">
        ${hasCoord(p)?`<p class="fine" style="margin:0">목적지는 저장된 좌표(${p.lat.toFixed(5)}, ${p.lng.toFixed(5)})로 넘겨요.</p>`:`<div class="warnbox">좌표가 없어 장소명·주소 검색으로 넘겨요. 외부 지도에서 맞는 장소인지 확인하세요.</div>`}
        <div class="field"><span class="lab">이동 수단</span><div class="checks"><label><input type="radio" name="rtm" value="transit" ${st.mode==="transit"?"checked":""}>대중교통</label><label><input type="radio" name="rtm" value="walk" ${st.mode==="walk"?"checked":""}>도보</label></div></div>
        <div class="field"><span class="lab">출발지</span><div class="checks">
          <label><input type="radio" name="rto" value="none" ${st.origin==="none"?"checked":""}>외부 지도에서 정하기</label>
          <label><input type="radio" name="rto" value="here" ${st.origin==="here"?"checked":""}>현재 위치</label>
          <label><input type="radio" name="rto" value="text" ${st.origin==="text"?"checked":""}>직접 입력</label></div>
          ${st.origin==="text"?`<input id="rtText" value="${esc(st.text)}" placeholder="예: 신촌역" style="margin-top:6px">`:""}
          ${st.msg?`<span class="fine">${esc(st.msg)}</span>`:""}</div>
        <div style="display:grid;gap:8px">
          <a class="btn" href="${esc(R.google)}" target="_blank" rel="noopener">구글 지도로 열기 <span class="meta">(웹·앱)</span></a>
          ${R.kakao?`<a class="btn" href="${esc(R.kakao)}" target="_blank" rel="noopener">카카오맵으로 열기 <span class="meta">(웹, 휴대폰은 모바일웹)</span></a><span class="fine">${esc(R.kakaoNote)}</span>`:""}
          ${R.naverApp?`<a class="btn" href="${esc(R.naverApp)}">네이버 지도 앱으로 열기</a><span class="fine">${IS_PHONE?"네이버 지도 앱이 설치되어 있어야 열려요. 앱이 없으면 아래 웹 링크를 쓰세요.":"PC에서는 네이버 앱 연결이 열리지 않아요. 휴대폰에서 쓰거나 아래 웹 링크를 쓰세요."} 출발지를 안 넣으면 앱이 현재 위치를 써요.</span>`:""}
          <a class="btn" href="${esc(R.naverWeb)}" target="_blank" rel="noopener">네이버 지도 웹에서 장소 열기</a><span class="fine">네이버 웹은 길찾기 주소 형식이 공개 문서로 없어 장소 페이지만 열어요(장소ID 주소는 비공식 형식). 길찾기는 네이버 화면에서 눌러 주세요.</span>
        </div>
        <p class="fine" style="margin:0">이 앱은 경로·소요시간·환승을 직접 계산하지 않아요. 결과는 각 지도 서비스에서 확인하세요.</p>
      </div></div></div>`;
    root.querySelector('[data-rt="close"]').focus();
  };
  const close=()=>{ root.innerHTML=""; root.removeEventListener("click",onClick); root.removeEventListener("change",onChange); root.removeEventListener("keydown",onKey); lastFocus?.focus?.(); };
  const onKey=e=>{ if(e.key==="Escape") close(); };
  const onClick=e=>{ if(e.target.classList.contains("overlay")||e.target.closest('[data-rt="close"]')) close(); };
  const onChange=e=>{
    const t=e.target;
    if (t.name==="rtm"){ st.mode=t.value; draw(); }
    else if (t.id==="rtText"){ st.text=t.value; draw(); }
    else if (t.name==="rto"){
      st.origin=t.value; st.msg="";
      if (t.value==="here"){
        if (!navigator.geolocation){ st.msg="이 브라우저는 위치 기능을 지원하지 않아요. 직접 입력을 쓰세요."; st.origin="none"; draw(); return; }
        st.msg="위치 권한을 요청하는 중… (브라우저 알림에서 허용을 눌러 주세요)"; draw();
        navigator.geolocation.getCurrentPosition(pos=>{ st.here={lat:pos.coords.latitude,lng:pos.coords.longitude}; st.msg=`현재 위치를 넣었어요 (오차 약 ${Math.round(pos.coords.accuracy)}m). 이 좌표는 저장하지 않아요.`; draw(); },
          err=>{ st.origin="none"; st.here=null; st.msg = err.code===1 ? "위치 권한이 거부됐어요. 직접 입력하거나 외부 지도에서 출발지를 정하세요." : "현재 위치를 가져오지 못했어요. 직접 입력하거나 외부 지도에서 정하세요."; draw(); },
          {enableHighAccuracy:false,timeout:10000,maximumAge:60000});
      } else draw();
    }
  };
  root.addEventListener("click",onClick); root.addEventListener("change",onChange); root.addEventListener("keydown",onKey);
  draw();
}

/* =====================================================================
   14. 안내 패널
   ===================================================================== */
function storageNote(){
  const m=S.store?.mode;
  if (m==="public") return "읽기 전용 공개 지도예요. 운영자가 공개한 장소·사진만 보이고, 이 화면에서는 아무것도 바꾸거나 저장하지 않아요. 사진 저작권은 youngphoto0204에 있어요.";
  if (m==="preview") return "공개 화면 미리보기 중이에요. 상단의 상태 버튼을 누르면 편집 화면으로 돌아가요.";
  return m==="local" ? "지금은 이 컴퓨터의 이 브라우저에만 저장돼요. 다른 기기·다른 브라우저·다른 방문자에게는 보이지 않고, 브라우저의 사이트 데이터를 지우면 사라져요. 전체 백업을 저장해 두세요."
    : "지금은 저장 공간을 쓸 수 없어 임시로만 동작해요. 새로고침하면 등록한 내용이 사라져요.";
}
function openAbout(){
  lastFocus=document.activeElement;
  const root=$("#overlayRoot");
  const pub=PUBLIC_MODE;
  root.innerHTML=`<div class="overlay" role="dialog" aria-modal="true" aria-labelledby="abTitle"><div class="panel narrow">
    <div class="panel-head"><h2 id="abTitle">안내와 현재 한계</h2><button type="button" class="btn small" id="abClose">닫기</button></div>
    <div class="panel-body" style="gap:10px;font-size:14px">
      <p style="margin:0"><b>저장:</b> ${storageNote()}</p>
      <p style="margin:0"><b>방문 정보:</b> 제작 시점에 조사해 파일에 넣은 값이에요. 확인일과 출처를 함께 표시하고, 찾지 못한 값은 ‘미확인’으로 둬요. 이 지도는 정보를 자동으로 최신화하지 않으니 방문 전 공식 안내를 확인하세요.</p>
      <p style="margin:0"><b>촬영 제안:</b> 공식 안내가 아닌 추천이에요. 대표 좌표로는 실제 조망이나 가림을 판단할 수 없어요.</p>
      <p style="margin:0"><b>지도:</b> OpenFreeMap(OpenStreetMap 데이터)을 MapLibre로 표시해요. 숫자 원은 가까운 장소 묶음이고, 빨간 테두리는 사진이 있는 곳이에요. 배경 지도 서버에 연결하지 못하면 배경 없이 철도망·출사지·방향선만 보여요.</p>
      <p style="margin:0"><b>철도망:</b> OpenStreetMap 선로 자료(ODbL)를 가공한 수도권 전철 ${RAIL.d?RAIL.d.lines.length:""}개 노선이에요. 선형은 OpenStreetMap 노선의 실제 선로 좌표를 2m 이내로만 줄인 것이에요(2026-11-20 수신).</p>
      <p style="margin:0"><b>거리:</b> ‘가까운 역’의 거리는 직선거리예요. 도보 경로를 계산하지 않아요. 출구의 ‘공식 표기’는 출처에 적힌 값이에요.</p>
      <p style="margin:0"><b>경로 찾기:</b> 역 연결과 확인된 환승만 써요. 시간표·급행·막차는 쓰지 않아 소요시간은 보여 주지 않아요.</p>
      <p style="margin:0"><b>해·달:</b> 관측 위치·날짜·시각으로 계산해요. 지형·건물·날씨는 반영하지 않아요.</p>
      <p style="margin:0"><b>길찾기:</b> 네이버·카카오·구글 지도를 여는 연결이에요. 경로와 시간은 각 서비스에서 계산해요.</p>
      ${pub?"":`<p style="margin:0"><b>새 JSON:</b> 파일을 올릴 때만 비교·교체돼요. 자동 동기화는 없어요. 직접 입력값, 메모, 사진은 유지하고 제외 장소는 보관함으로 옮겨요.</p>
      <p style="margin:0"><b>공개:</b> 공개 지도는 ‘공개용 index.html’을 올린 읽기 전용 파일이에요. 이 브라우저의 편집 내용은 다시 내보내 올리기 전까지 공개 지도에 반영되지 않아요.</p>`}
    </div></div></div>`;
  const close=()=>{ root.innerHTML=""; lastFocus?.focus?.(); };
  root.querySelector("#abClose").addEventListener("click",close);
  root.querySelector(".overlay").addEventListener("keydown",e=>{ if(e.key==="Escape") close(); });
  root.querySelector(".overlay").addEventListener("click",e=>{ if(e.target.classList.contains("overlay")) close(); });
  root.querySelector("#abClose").focus();
}
$("#aboutBtn").addEventListener("click",openAbout);
$("#statusBtn").addEventListener("click",()=>openAbout());

/* =====================================================================
   16. 철도망 (OSM 선형) — 데이터 읽기, 지도 레이어, 역명 라벨, 노선 강조
       데이터: data/rail.json (빌드 때 HTML 안 <script id="railData">에 넣을 수도 있음)
   ===================================================================== */
const RAIL_URL = "data/rail.json";
const RAIL = { state:"idle", err:"", d:null, hidden:new Set(), focus:null, labels:[], adj:null, route:null,
  from:null, to:null, crit:"transfer", allowUnver:false, q:{from:"",to:""} };
function railPrefsLoad(){ try { const o=JSON.parse(localStorage.getItem("spm-rail")||"{}"); (o.hidden||[]).forEach(x=>RAIL.hidden.add(x)); if(o.crit) RAIL.crit=o.crit; } catch(e){} }
function railPrefsSave(){ try { localStorage.setItem("spm-rail",JSON.stringify({hidden:[...RAIL.hidden],crit:RAIL.crit})); } catch(e){} }

async function loadRail(){
  RAIL.state="loading"; renderSheet();
  try {
    let j=null;
    const emb=document.getElementById("railData");
    if (emb && emb.textContent.trim().length>2) j=JSON.parse(emb.textContent);
    else {
      let r;
      try { r=await fetch(RAIL_URL,{cache:"no-cache"}); }
      catch(e){ throw new Error("철도 데이터 파일에 연결하지 못했어요 ("+(e.message||"네트워크 오류")+")"); }
      if (r.status===404) { RAIL.state="empty"; RAIL.err="data/rail.json 파일이 없어요"; renderSheet(); return; }
      if (!r.ok) throw new Error("철도 데이터 요청 실패 (HTTP "+r.status+")");
      j=await r.json();
    }
    if (!j || !Array.isArray(j.lines) || !j.lines.length || !Array.isArray(j.stations)){ RAIL.state="empty"; RAIL.err="철도 데이터가 비어 있어요"; renderSheet(); return; }
    prepRail(j); RAIL.state="ready";
  } catch(e){ RAIL.state="fail"; RAIL.err=e.message||String(e); }
  renderSheet(); syncRail(); if(S.sel) renderDetail();
}
function prepRail(j){
  const d={...j};
  d.lineIdx=new Map(j.lines.map((l,i)=>[l.id,i]));
  d.st=j.stations.map((s,i)=>({...s, i, li:s.lines.map(id=>d.lineIdx.get(id)).filter(x=>x!=null)}));
  d.adj=new Map();
  j.edges.forEach((e,k)=>{ const [a,b,l]=e; for(const [x,y] of [[a,b],[b,a]]){ const key=x+"|"+l; if(!d.adj.has(key)) d.adj.set(key,[]); d.adj.get(key).push({to:y,e:k}); } });
  d.tr=new Map(); // station -> Map(pairKey -> {kind, m})
  for (const [si,pairs] of Object.entries(j.transfers||{})) for (const [pk,m] of Object.entries(pairs)){ if(!d.tr.has(+si)) d.tr.set(+si,new Map()); d.tr.get(+si).set(pk,{kind:"osm",m}); }
  for (const [si,pks] of Object.entries(j.manualTransfers||{})) for (const pk of pks){ if(!d.tr.has(+si)) d.tr.set(+si,new Map()); if(!d.tr.get(+si).has(pk)) d.tr.get(+si).set(pk,{kind:"manual",m:null}); }
  d.links=(j.links||[]).map(([a,la,b,lb,m])=>({a,la,b,lb,m}));
  d.exitsBy=new Map();
  for (const x of j.exits||[]){ const sid=x[3]; if(!d.exitsBy.has(sid)) d.exitsBy.set(sid,[]); d.exitsBy.get(sid).push({lng:x[0],lat:x[1],no:x[2]}); }
  RAIL.d=d;
}
function trKind(si, la, lb){
  const d=RAIL.d, A=d.lines[la].id, B=d.lines[lb].id, pk=[A,B].sort().join("|");
  return d.tr.get(si)?.get(pk) || null;
}
const railVisible = li => !RAIL.hidden.has(RAIL.d.lines[li].id);
function lineDots(lis){ return `<span class="dots">${lis.map(li=>`<i style="--lc:${esc(RAIL.d.lines[li].color||"#888")}" title="${esc(RAIL.d.lines[li].name)}"></i>`).join("")}</span>`; }
function stLabel(s){ return `${esc(s.name)} ${lineDots(s.li)}`; }

function railLineFC(){
  return {type:"FeatureCollection",features:RAIL.d.lines.map((l,li)=>({type:"Feature",properties:{li,c:l.color||"#888"},geometry:{type:"MultiLineString",coordinates:l.geom}}))};
}
function railStFC(){
  const f=[];
  for (const s of RAIL.d.st){
    const vis=s.li.filter(railVisible); if(!vis.length) continue;
    const isTr=s.li.length>1 || RAIL.d.links.some(k=>k.a===s.i||k.b===s.i);
    const foc=RAIL.focus==null || s.li.includes(RAIL.focus);
    f.push({type:"Feature",properties:{i:s.i,tr:isTr?1:0,c:RAIL.d.lines[vis[0]].color||"#888",f:foc?1:0},geometry:{type:"Point",coordinates:[s.lng,s.lat]}});
  }
  return {type:"FeatureCollection",features:f};
}
function cssVar(n){ return getComputedStyle(document.documentElement).getPropertyValue(n).trim()||"#888"; }
function addRailLayers(m){
  const emptyFC={type:"FeatureCollection",features:[]};
  m.addSource("rail-ln",{type:"geojson",data:emptyFC});
  m.addSource("rail-st",{type:"geojson",data:emptyFC});
  m.addSource("route",{type:"geojson",data:emptyFC});
  m.addLayer({id:"rail-case",type:"line",source:"rail-ln",layout:{"line-cap":"round","line-join":"round"},paint:{"line-color":cssVar("--map-land"),"line-width":["interpolate",["linear"],["zoom"],9,2.5,13,6,16,9],"line-opacity":0.85}});
  m.addLayer({id:"rail-line",type:"line",source:"rail-ln",layout:{"line-cap":"round","line-join":"round"},paint:{"line-color":["get","c"],"line-width":["interpolate",["linear"],["zoom"],9,1.4,13,3.5,16,6]}});
  m.addLayer({id:"route-case",type:"line",source:"route",layout:{"line-cap":"round","line-join":"round"},paint:{"line-color":cssVar("--ink"),"line-width":["interpolate",["linear"],["zoom"],9,7,14,13]}});
  m.addLayer({id:"route-line",type:"line",source:"route",layout:{"line-cap":"round","line-join":"round"},paint:{"line-color":["get","c"],"line-width":["interpolate",["linear"],["zoom"],9,4,14,8]}});
  const TR=["==",["get","tr"],1];
  m.addLayer({id:"rail-st",type:"circle",source:"rail-st",minzoom:10.5,
    paint:{"circle-radius":["interpolate",["linear"],["zoom"],10.5,["case",TR,3,0],11.9,["case",TR,4,0],12,["case",TR,4.2,2.5],14,["case",TR,6,4.5]],
      "circle-color":cssVar("--surface-panel"),"circle-stroke-color":["case",["==",["get","tr"],1],cssVar("--ink"),["get","c"]],"circle-stroke-width":["case",["==",["get","tr"],1],2,2],
      "circle-opacity":["case",["==",["get","f"],1],1,0.25],"circle-stroke-opacity":["case",["==",["get","f"],1],1,0.25]}});
}
function bindRailHandlers(m){
  m.on("click","rail-st",e=>{ if(MAP.pick) return; const f=e.features[0]; stationPopup(+f.properties.i, e.lngLat); });
  m.on("mouseenter","rail-st",()=>{ m.getCanvas().style.cursor="pointer"; });
  m.on("mouseleave","rail-st",()=>{ m.getCanvas().style.cursor=MAP.pick?"crosshair":""; });
}
function syncRail(){
  if (!MAP.m || MAP.state!=="ready" || !MAP.m.getSource("rail-ln")) return;
  const m=MAP.m, on=MAP.app.rail && RAIL.state==="ready";
  for (const id of ["rail-case","rail-line","rail-st"]) m.setLayoutProperty(id,"visibility",on?"visible":"none");
  if (!on){ m.getSource("rail-ln").setData({type:"FeatureCollection",features:[]}); clearLabels(); syncRoute(); return; }
  m.getSource("rail-ln").setData(railLineFC());
  m.getSource("rail-st").setData(railStFC());
  const hid=[...RAIL.hidden].map(id=>RAIL.d.lineIdx.get(id)).filter(x=>x!=null);
  const filt=["!",["in",["get","li"],["literal",hid]]];
  m.setFilter("rail-line",filt); m.setFilter("rail-case",filt);
  const fop=RAIL.focus==null?railOpacity():["case",["==",["get","li"],RAIL.focus],1,0.15]; // 노선은 공식 색 그대로, 마커보다 튀지 않게 라이트 0.75 · 다크 0.85 (map-style.md)
  m.setPaintProperty("rail-line","line-opacity",RAIL.route?0.35:fop);
  syncRoute(); updateLabels();
}
function railOpacity(){ return effTheme()==="dark"?0.85:0.75; }
function themeRefreshRail(){
  if (!MAP.m || !MAP.m.getLayer("rail-case")) return;
  if (RAIL.focus==null && !RAIL.route) MAP.m.setPaintProperty("rail-line","line-opacity",railOpacity());
  MAP.m.setPaintProperty("rail-case","line-color",cssVar("--map-land"));
  MAP.m.setPaintProperty("route-case","line-color",cssVar("--ink"));
  MAP.m.setPaintProperty("rail-st","circle-color",cssVar("--surface-panel"));
  MAP.m.setPaintProperty("rail-st","circle-stroke-color",["case",["==",["get","tr"],1],cssVar("--ink"),["get","c"]]);
}
/* 역명: 확대 수준에 따라 환승역 → 일반역 순서로, 화면에서 겹치지 않는 것만 표시 */
function clearLabels(){ RAIL.labels.forEach(x=>x.remove()); RAIL.labels=[]; }
function updateLabels(){
  clearLabels();
  if (!MAP.m || MAP.state!=="ready" || RAIL.state!=="ready" || !MAP.app.rail) return;
  const m=MAP.m, z=m.getZoom(), b=m.getBounds(), W=m.getContainer().clientWidth, H=m.getContainer().clientHeight;
  const routeSt=new Set(RAIL.route? RAIL.route.legs.flatMap(l=>[l.st[0],l.st[l.st.length-1]]) : []);
  const cands=[];
  for (const s of RAIL.d.st){
    if (!s.li.some(railVisible)) continue;
    if (!b.contains([s.lng,s.lat])) continue;
    const tr=s.li.length>1, rt=routeSt.has(s.i);
    if (rt) continue; // 출발·도착 표지가 이름을 보여 줌
    if (RAIL.focus!=null && !s.li.includes(RAIL.focus) && !rt) continue;
    const need = rt ? 9 : tr ? 11.6 : 12.8;
    if (z<need) continue;
    cands.push({s,tr,rt,pr:rt?0:tr?1:2});
  }
  cands.sort((a,b)=>a.pr-b.pr);
  const boxes=[], max=isMobile()?45:90;
  for (const c of cands){
    if (RAIL.labels.length>=max) break;
    const p=m.project([c.s.lng,c.s.lat]), w=c.s.name.length*12+12, h=18;
    const bx={x1:p.x-w/2,x2:p.x+w/2,y1:p.y-26,y2:p.y-26+h};
    if (bx.x1<0||bx.x2>W||bx.y1<0||bx.y2>H) continue;
    if (boxes.some(o=>!(bx.x2<o.x1||bx.x1>o.x2||bx.y2<o.y1||bx.y1>o.y2))) continue;
    boxes.push(bx);
    const el=document.createElement("span"); el.className="stlbl"+(c.tr?" tr":"")+(c.rt?" rt":""); el.textContent=c.s.name;
    RAIL.labels.push(new maplibregl.Marker({element:el,anchor:"bottom"}).setLngLat([c.s.lng,c.s.lat]).addTo(m));
  }
}
function stationPopup(i, ll){
  const s=RAIL.d.st[i];
  const links=RAIL.d.links.filter(k=>k.a===i||k.b===i).map(k=>{ const o=RAIL.d.st[k.a===i?k.b:k.a]; return `<div class="fine">${esc(o.name)}역과 환승 연결 (수동 확인, 약 ${k.m}m)</div>`; }).join("");
  const pairs=[];
  for (let x=0;x<s.li.length;x++) for (let y=x+1;y<s.li.length;y++){ const k=trKind(i,s.li[x],s.li[y]); pairs.push(`${esc(RAIL.d.lines[s.li[x]].name)}↔${esc(RAIL.d.lines[s.li[y]].name)}: ${k?(k.kind==="osm"?"OSM 정차점 확인":"수동 확인"):"미확인"}`); }
  const html=`<div style="display:grid;gap:6px;min-width:180px"><b style="font-size:14px">${esc(s.name)}역</b><div>${s.li.map(li=>`<div style="display:flex;gap:6px;align-items:center;font-weight:500">${lineDots([li])}${esc(RAIL.d.lines[li].name)}</div>`).join("")}</div>${pairs.length?`<div class="fine">${pairs.join("<br>")}</div>`:""}${links}<div style="display:flex;gap:6px"><button type="button" class="btn small" data-act="rt-from" data-st="${i}">출발역으로</button><button type="button" class="btn small" data-act="rt-to" data-st="${i}">도착역으로</button></div><span class="fine">점은 역 묶음의 대표 좌표예요. 출입구 위치와 다를 수 있어요.</span></div>`;
  MAP.stPop?.remove();
  MAP.stPop=new maplibregl.Popup({closeButton:true,maxWidth:"280px",offset:10}).setLngLat(ll||[s.lng,s.lat]).setHTML(html).addTo(MAP.m);
}

/* =====================================================================
   17. 역 간 경로 찾기 — 역 연결(선형 위 순서)과 확인된 환승만 사용. 시간표·급행·운행 계통은 반영하지 않음
   ===================================================================== */
function findRoute(from, to){
  const d=RAIL.d, crit=RAIL.crit, allowU=RAIL.allowUnver;
  const W = crit==="transfer" ? {ride:1, xfer:10000} : {ride:1000, xfer:1};
  const key=(s,l)=>s+"|"+l, dist=new Map(), prev=new Map(), heap=[];
  const push=(c,k)=>{ heap.push([c,k]); let i=heap.length-1; while(i>0){ const p=(i-1)>>1; if(heap[p][0]<=heap[i][0]) break; [heap[p],heap[i]]=[heap[i],heap[p]]; i=p; } };
  const pop=()=>{ const top=heap[0], last=heap.pop(); if(heap.length){ heap[0]=last; let i=0; for(;;){ const l=2*i+1,r=l+1; let m=i; if(l<heap.length&&heap[l][0]<heap[m][0]) m=l; if(r<heap.length&&heap[r][0]<heap[m][0]) m=r; if(m===i) break; [heap[m],heap[i]]=[heap[i],heap[m]]; i=m; } } return top; };
  for (const l of d.st[from].li) if (railVisible(l)){ dist.set(key(from,l),0); push(0,key(from,l)); }
  let goal=null, usedUnver=false;
  while (heap.length){
    const [c,k]=pop(); if (c>(dist.get(k)??Infinity)) continue;
    const [s,l]=k.split("|").map(Number);
    if (s===to){ goal=k; break; }
    const relax=(nk,nc,info)=>{ if (nc<(dist.get(nk)??Infinity)){ dist.set(nk,nc); prev.set(nk,{k,info}); push(nc,nk); } };
    for (const n of d.adj.get(key(s,l))||[]) relax(key(n.to,l), c+W.ride, {type:"ride",e:n.e});
    for (const l2 of d.st[s].li){
      if (l2===l || !railVisible(l2)) continue;
      const tk=trKind(s,l,l2);
      if (!tk && !allowU) continue;
      relax(key(s,l2), c+W.xfer, {type:"xfer",kind:tk?tk.kind:"unverified",m:tk?tk.m:null});
    }
    for (const lk of d.links){
      if (lk.a===s && lk.la===l && railVisible(lk.lb)) relax(key(lk.b,lk.lb), c+W.xfer, {type:"xfer",kind:"manual-link",m:lk.m});
      if (lk.b===s && lk.lb===l && railVisible(lk.la)) relax(key(lk.a,lk.la), c+W.xfer, {type:"xfer",kind:"manual-link",m:lk.m});
    }
  }
  if (!goal) return null;
  const steps=[]; let k=goal;
  while (prev.has(k)){ const p=prev.get(k); steps.unshift({from:p.k,to:k,info:p.info}); k=p.k; }
  const legs=[], xfers=[];
  let cur=null;
  for (const st of steps){
    const [s1,l1]=st.from.split("|").map(Number), [s2,l2]=st.to.split("|").map(Number);
    if (st.info.type==="ride"){
      if (!cur || cur.li!==l1){ cur={li:l1,st:[s1],e:[]}; legs.push(cur); }
      cur.st.push(s2); cur.e.push(st.info.e);
    } else { xfers.push({at:s1, to:s2, from:l1, toLine:l2, kind:st.info.kind, m:st.info.m}); if(st.info.kind==="unverified") usedUnver=true; cur=null; }
  }
  return {legs, xfers, stops:legs.reduce((a,l)=>a+l.e.length,0), usedUnver, from, to};
}
function runRoute(){
  RAIL.route=null; RAIL.routeMsg="";
  if (RAIL.state!=="ready" || RAIL.from==null || RAIL.to==null){ renderSheet(); syncRail(); return; }
  if (RAIL.from===RAIL.to){ RAIL.routeMsg="출발역과 도착역이 같아요."; renderSheet(); syncRail(); return; }
  const r=findRoute(RAIL.from,RAIL.to);
  if (!r){
    let why="현재 데이터의 역 연결과 확인된 환승만으로는 경로를 찾지 못했어요.";
    if (!RAIL.allowUnver){ const saved=RAIL.allowUnver; RAIL.allowUnver=true; const r2=findRoute(RAIL.from,RAIL.to); RAIL.allowUnver=saved; if(r2) why+=" ‘미확인 환승 포함’을 켜면 미확인 환승을 지나는 경로가 있어요."; }
    if (RAIL.hidden.size) why+=" 숨긴 노선은 경로에서 빼고 있어요.";
    RAIL.routeMsg=why; renderSheet(); syncRail(); return;
  }
  RAIL.route=r; renderSheet(); syncRail(); fitRoute();
}
function syncRoute(){
  if (!MAP.m || !MAP.m.getSource("route")) return;
  MAP.rtMk?.forEach(x=>x.remove()); MAP.rtMk=[];
  const r=RAIL.route, on=r && MAP.app.rail && RAIL.state==="ready";
  if (!on){ MAP.m.getSource("route").setData({type:"FeatureCollection",features:[]}); return; }
  const feats=r.legs.map(l=>{
    const co=[]; l.e.forEach((ei,k)=>{ const [a,b,,g]=RAIL.d.edges[ei]; const forward = a===l.st[k]; const seg=forward?g:g.slice().reverse(); co.push(...(co.length?seg.slice(1):seg)); });
    return {type:"Feature",properties:{c:RAIL.d.lines[l.li].color||"#888"},geometry:{type:"LineString",coordinates:co}};
  });
  MAP.m.getSource("route").setData({type:"FeatureCollection",features:feats});
  const mk=(si,t)=>{ const s=RAIL.d.st[si], el=document.createElement("span"); el.className="rtend"; el.textContent=t+" "+s.name; MAP.rtMk.push(new maplibregl.Marker({element:el,anchor:"bottom"}).setLngLat([s.lng,s.lat]).addTo(MAP.m)); };
  mk(r.from,"출발"); mk(r.to,"도착");
}
function fitRoute(){
  if (!MAP.m || MAP.state!=="ready" || !RAIL.route) return;
  const b=new maplibregl.LngLatBounds();
  RAIL.route.legs.forEach(l=>l.st.forEach(si=>b.extend([RAIL.d.st[si].lng,RAIL.d.st[si].lat])));
  MAP.m.fitBounds(b,{padding:isMobile()?{top:70,bottom:Math.round(innerHeight*0.5),left:30,right:40}:{top:70,bottom:60,left:50,right:420},maxZoom:14,duration:0});
}
function searchStations(q){
  q=q.trim().replace(/역$/,""); if(!q||RAIL.state!=="ready") return [];
  const n=normName(q);
  return RAIL.d.st.filter(s=>normName(s.name).includes(n)).sort((a,b)=>(normName(a.name).startsWith(n)?0:1)-(normName(b.name).startsWith(n)?0:1)||a.name.length-b.name.length).slice(0,12);
}
/* 출사지 주변 역: 역 묶음 좌표·OSM 출입구 좌표와의 직선거리 (걷는 길이 아님) */
function nearStationsRail(p, n=3){
  if (RAIL.state!=="ready" || !hasCoord(p)) return [];
  return RAIL.d.st.map(s=>{ const ex=RAIL.d.exitsBy.get(s.id)||[]; let be=null; for(const x of ex){ const dd=distM(p,x); if(!be||dd<be.d) be={d:dd,no:x.no}; } return {s,d:distM(p,s),ex:be}; })
    .filter(x=>x.d<=2000).sort((a,b)=>a.d-b.d).slice(0,n);
}
function fmtM(m){ return m>=1000?(m/1000).toFixed(1)+"km":Math.round(m/10)*10+"m"; }
/* 가는 길: 조사한 지하철·도보 정보(rows) + 철도 데이터로 계산한 가까운 역을 한 섹션에 */
function nearHTML(p, rows="", miss=[]){
  const top=(rows?`<dl class="kv">${rows}</dl>`:"")+missLine(miss);
  const wrap=body=>`<section class="dsec" aria-label="가는 길"><h3>가는 길</h3>${top}${body}</section>`;
  if (!hasCoord(p)) return top?wrap(""):"";
  if (RAIL.state==="loading") return wrap(`<p class="fine">가까운 역을 계산하는 중이에요.</p>`);
  if (RAIL.state!=="ready") return wrap(`<p class="fine">철도 데이터가 없어 가까운 역을 계산할 수 없어요. ${esc(RAIL.err||"")}</p>`);
  const list=nearStationsRail(p);
  return wrap(`<h4 class="dsub">가까운 역 (직선거리)</h4>
    ${list.length?`<ul class="nearst">${list.map(x=>`<li><div>${stLabel(x.s)}<div class="d">역까지 ${fmtM(x.d)}${x.ex?` · ${esc(x.ex.no||"번호 미상")}번 출구 ${fmtM(x.ex.d)}`:" · 출입구 자료 없음"}</div></div><button type="button" class="btn small" data-act="rt-to" data-st="${x.s.i}">도착역으로</button></li>`).join("")}</ul>`:`<p class="fine">2km 안에 데이터에 있는 역이 없어요.</p>`}
    <p class="fine">직선거리라 실제로 걷는 길은 더 길 수 있어요. 걷는 경로는 ‘길찾기’에서 외부 지도로 확인하세요. 출입구 위치는 OpenStreetMap 자료예요.</p>`);
}

/* =====================================================================
   18. 지도 도구 시트 — 노선 · 경로 · 해·달 · 정보
   ===================================================================== */
S.sheetTab = "lines"; S.sheetOpen = false; // 처음에는 접어 두어 지도를 가리지 않음
function renderSheet(){
  const el=$("#toolSheet"); if(!el) return;
  el.dataset.open=String(S.sheetOpen);
  el.querySelectorAll("[data-tab]").forEach(b=>b.setAttribute("aria-selected",String(b.dataset.tab===S.sheetTab&&S.sheetOpen)));
  $("#sheetX").setAttribute("aria-expanded",String(S.sheetOpen));
  $("#sheetHandle").hidden=S.sheetOpen;
  if (!S.sheetOpen) return;
  const body=$("#sheetBody");
  const keepScroll=body.scrollTop;
  if (S.sheetTab==="lines") body.innerHTML=linesHTML();
  else if (S.sheetTab==="route") body.innerHTML=routeHTML();
  else if (S.sheetTab==="astro") body.innerHTML=sheetAstroHTML();
  else { S.sheetTab="lines"; body.innerHTML=linesHTML(); }
  body.scrollTop=keepScroll;
}
function railStateBox(){
  if (RAIL.state==="loading"||RAIL.state==="idle") return `<div class="ms-box" role="status" style="justify-items:start;text-align:left"><span class="spin"></span><span>철도 데이터를 불러오는 중…</span></div>`;
  if (RAIL.state==="fail") return `<div class="warnbox" role="alert">철도 데이터를 불러오지 못했어요: ${esc(RAIL.err)} <button type="button" class="btn small" data-act="rail-retry">다시 시도</button></div>`;
  if (RAIL.state==="empty") return `<div class="warnbox">철도 데이터가 없어요 (${esc(RAIL.err)}).</div>`;
  return "";
}
function linesHTML(){
  const box=railStateBox(); if (box) return box;
  const d=RAIL.d, cnt=new Map(); d.st.forEach(s=>s.li.forEach(l=>cnt.set(l,(cnt.get(l)||0)+1)));
  return `<div class="chiprow"><button type="button" class="btn small" data-act="rail-toggle" aria-pressed="${MAP.app.rail}">${MAP.app.rail?"철도망 끄기":"철도망 켜기"}</button><button type="button" class="btn small" data-act="ln-all">모두 보기</button><button type="button" class="btn small" data-act="ln-none">모두 숨김</button>${RAIL.focus!=null?`<button type="button" class="btn small" data-act="ln-unfocus">강조 해제</button>`:""}</div>
    <p class="fine" style="margin:0">노선 이름을 누르면 그 노선을 강조하고 나머지는 흐리게 표시해요. 체크를 끄면 지도와 경로 찾기에서 빠져요.</p>
    <ul class="lnlist">${d.lines.map((l,li)=>`<li class="lnrow" data-focus="${RAIL.focus===li}"><input type="checkbox" data-ln="${esc(l.id)}" ${railVisible(li)?"checked":""} aria-label="${esc(l.name)} 표시"><span class="lnbar" style="--lc:${esc(l.color||"#888")}"></span><button type="button" class="nm" data-act="ln-focus" data-li="${li}">${esc(l.name)}</button><span class="ct num">${cnt.get(li)||0}역</span></li>`).join("")}</ul>`;
}
function stPicker(which){
  const v=RAIL[which]; const s=v!=null?RAIL.d.st[v]:null;
  return `<div class="field"><label for="rt-${which}">${which==="from"?"출발역":"도착역"}</label><div class="stinput"><input id="rt-${which}" data-rtq="${which}" autocomplete="off" placeholder="역 이름 검색 또는 지도에서 역 누르기" value="${esc(s?s.name:RAIL.q[which])}">${RAIL.sugg===which?`<ul class="sugg" role="listbox">${searchStations(RAIL.q[which]).map(x=>`<li><button type="button" data-act="rt-pick" data-which="${which}" data-st="${x.i}">${esc(x.name)} ${lineDots(x.li)}</button></li>`).join("")||`<li class="fine" style="padding:6px">일치하는 역이 없어요</li>`}</ul>`:""}</div>${s?`<span class="fine">${lineDots(s.li)} ${s.li.map(l=>esc(RAIL.d.lines[l].name)).join(" · ")}</span>`:""}</div>`;
}
function routeHTML(){
  const box=railStateBox(); if (box) return box;
  const r=RAIL.route, d=RAIL.d;
  const xferLabel=x=>x.kind==="osm"?`<span class="badge fact">OSM 정차점 확인</span>`:x.kind==="manual"||x.kind==="manual-link"?`<span class="badge sug">수동 확인 환승</span>`:`<span class="badge warn">미확인 환승</span>`;
  let res="";
  if (RAIL.routeMsg) res=`<div class="warnbox" role="status">${esc(RAIL.routeMsg)}</div>`;
  else if (r){
    const parts=[];
    r.legs.forEach((l,k)=>{
      const ln=d.lines[l.li], a=d.st[l.st[0]], b=d.st[l.st[l.st.length-1]], mid=l.st.slice(1,-1);
      const br=mid.filter(si=>(d.adj.get(si+"|"+l.li)||[]).length>=3).map(si=>d.st[si].name);
      parts.push(`<div class="leg" style="--lc:${esc(ln.color||"#888")}"><span class="bar"></span><div class="lt"><span class="meta">${esc(ln.name)}</span><b>${esc(a.name)} → ${esc(b.name)}</b><span class="meta num">${l.e.length}개 역 이동 (정차 ${l.e.length}회)</span>${br.length?`<span class="tag warn" style="justify-self:start">분기역 ${esc(br.join("·"))} 통과: 운행 계통에 따라 갈아타야 할 수 있어요</span>`:""}${mid.length?`<details class="mid"><summary>지나는 역 ${mid.length}곳</summary><ol>${mid.map(si=>`<li>${esc(d.st[si].name)}</li>`).join("")}</ol></details>`:""}</div></div>`);
      const x=r.xfers[k]; if (x) parts.push(`<div class="xfer">↳ <b>${esc(d.st[x.at].name)}</b>에서 ${esc(d.lines[x.toLine].name)}(으)로 환승 ${xferLabel(x)}${x.m!=null?`<span class="fine">정차점 사이 약 ${x.m}m (직선)</span>`:""}</div>`);
    });
    res=`<div class="rtsum"><span>환승 <b class="num">${r.xfers.length}</b>회</span><span>이동 <b class="num">${r.stops}</b>개 역</span><span>${RAIL.crit==="transfer"?"최소 환승 기준":"최소 정차역 기준"}</span></div>${parts.join("")}
      ${r.usedUnver?`<div class="warnbox">이 경로에는 원천 데이터로 확인되지 않은 환승이 있어요. 실제로 갈아탈 수 있는지 확인하세요.</div>`:""}
      <p class="fine" style="margin:0">시간표를 쓰지 않아 소요시간은 계산하지 않아요. 급행·직결·운행 계통(어느 열차가 어디까지 가는지)과 분기 구간에서 열차를 바꿔 타야 하는지는 반영하지 않아요. 같은 노선 안에서 분기를 지나는 경우 실제로는 갈아타야 할 수 있어요.</p>`;
  }
  return `<div class="rtform"><div class="ins">${stPicker("from")}${stPicker("to")}</div><button type="button" class="btn small" data-act="rt-swap" aria-label="출발·도착 바꾸기" title="출발·도착 바꾸기">⇅</button></div>
    <div class="chiprow"><span class="seg" role="group" aria-label="경로 기준"><button type="button" data-act="rt-crit" data-v="transfer" aria-pressed="${RAIL.crit==="transfer"}">최소 환승</button><button type="button" data-act="rt-crit" data-v="stops" aria-pressed="${RAIL.crit==="stops"}">최소 정차역</button></span>
      <label class="fine" style="display:inline-flex;gap:5px;align-items:center"><input type="checkbox" id="rtUnver" ${RAIL.allowUnver?"checked":""}>미확인 환승 포함</label>
      <button type="button" class="btn small ghost" data-act="rt-clear">초기화</button></div>
    ${res||`<p class="fine" style="margin:0">역 이름을 검색하거나 지도에서 역 점을 눌러 출발·도착을 정하세요. 출사지 상세의 ‘가까운 역’에서도 도착역을 고를 수 있어요.</p>`}`;
}
function railInfoHTML(){
  const d=RAIL.d;
  const base = `<h3 style="font-size:15px">지도·데이터 출처</h3>
    <dl class="kv" style="grid-template-columns:72px minmax(0,1fr);font-size:13px">
      <dt>배경 지도</dt><dd>${MAP.mode==="tiles"?`OpenFreeMap (${esc(effTheme()==="dark"?"Dark":"Liberty")} 스타일), 데이터 © OpenStreetMap contributors`:`표시하지 않음 — ${esc(MAP.basicWhy||"배경 지도 없이 보기")}`}</dd>
      <dt>지도 엔진</dt><dd>MapLibre GL JS 5.6.0 (BSD-3)</dd>
      <dt>해 계산</dt><dd>SunCalc 알고리즘 (V. Agafonkin, BSD-2) 이식</dd>
      <dt>달 계산</dt><dd>J. Meeus 『Astronomical Algorithms』 47·48장 주요 항을 직접 구현. PyEphem 4.2.1과 2026년 대조: 위상 순간 최대 3분, 월출·월몰 최대 1분 차이</dd>
    </dl>`;
  const box=railStateBox(); if (box) return base+box;
  return base+`<h3 style="font-size:15px">철도 데이터</h3>
    <dl class="kv" style="grid-template-columns:72px minmax(0,1fr);font-size:13px">
      <dt>원천</dt><dd>© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap contributors</a>, <a href="https://opendatacommons.org/licenses/odbl/1-0/" target="_blank" rel="noopener">ODbL 1.0</a></dd>
      <dt>경유</dt><dd>${esc(d.source.via)}</dd>
      <dt>가공일</dt><dd>${esc(d.built)} (이 앱용으로 다시 가공)</dd>
      <dt>범위</dt><dd>수도권 전철·도시철도·경전철 ${d.lines.length}개 노선, 역 ${d.st.length}곳 (OSM 유형: subway·train·light_rail·monorail 중 승객 노선)</dd>
      <dt>빠진 노선</dt><dd>${d.skipped.map(x=>esc(x.name)).join(", ")} — 개통 전이거나, 일반·고속철도이거나, 선형이 OSM이 아닌 추정선이라 넣지 않았어요.</dd>
      <dt>역 순서</dt><dd>${esc(d.method.order)}. 결과는 노선별 역 목록으로 직접 확인했어요.</dd>
      <dt>환승</dt><dd>${esc(d.method.transfer)}. 일부 공식 환승역은 수동 확인 표시로 넣었어요.</dd>
    </dl>
    <div class="warnbox">선형은 OSM 선로 좌표를 2m 이내로만 줄인 것이에요. 지하 구간의 정확한 터널 위치를 측량한 도면이 아니에요. ${d.farlinked&&d.farlinked.length?`선형에서 300m 넘게 떨어진 역 묶음: ${d.farlinked.map(x=>esc(x.line+" "+x.station)).join(", ")}.`:""} ${d.unlinked&&d.unlinked.length?`선형에 연결되지 않은 역: ${d.unlinked.map(x=>esc(x.line+" "+x.station)).join(", ")}.`:""}</div>`;
}

/* =====================================================================
   19. 해·달 패널 — 관측 위치(출사지 또는 지도에서 고른 점) 기준. 날짜·시각은 Asia/Seoul
   ===================================================================== */
S.obsCustom = null; S.astroMode = "both"; S.calOpen = false; S.calMonth = null;
function placeObs(p){ return p && hasCoord(p) ? {lat:p.lat,lng:p.lng,name:p.name,kind:"place",id:p.id} : null; }
function curObs(){ return S.obsCustom || placeObs(S.sel && getPlace(S.sel)); }
function obsFor(root){ return root.dataset.obs==="place" ? placeObs(getPlace(S.sel)) : curObs(); }
function addDays(ds, n){ return SEOUL_DATE.format(new Date(new Date(ds+"T12:00:00+09:00").getTime()+n*864e5)); }
const SEOUL_MD = new Intl.DateTimeFormat("ko-KR",{timeZone:"Asia/Seoul",month:"numeric",day:"numeric",weekday:"short"});
// ‘11. 24. (화)’ 대신 ‘11월 24일 (화)’로 읽기 쉽게
function fmtDT(d){ if(!d) return "—"; const p=Object.fromEntries(SEOUL_MD.formatToParts(d).map(x=>[x.type,x.value])); return `${p.month}월 ${p.day}일 (${p.weekday}) ${fmtT(d)}`; }
function moonSVG(k, waxing, size){
  const r=size/2-1, c=size/2, rx=Math.abs(1-2*k)*r, gib=k>0.5;
  const so=waxing?1:0, st=waxing?(gib?1:0):(gib?0:1);
  const lit = k<0.005 ? "" : k>0.995 ? `<circle cx="${c}" cy="${c}" r="${r}" fill="var(--moon-lit)"/>` : `<path d="M${c},${c-r} A${r},${r} 0 0 ${so} ${c},${c+r} A${rx.toFixed(2)},${r} 0 0 ${st} ${c},${c-r}Z" fill="var(--moon-lit)"/>`;
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" aria-hidden="true"><circle cx="${c}" cy="${c}" r="${r}" fill="var(--moon-dark)" stroke="var(--line)" stroke-width="1"/>${lit}</svg>`;
}
function moonRS(o, date){
  const r=MOON.riseSet(date,o.lat,o.lng);
  if (!r.rise){ for (let i=1;i<=2&&!r.nextRise;i++){ const n=MOON.riseSet(addDays(date,i),o.lat,o.lng); if(n.rise) r.nextRise=n.rise; } }
  if (!r.set){ for (let i=1;i<=2&&!r.nextSet;i++){ const n=MOON.riseSet(addDays(date,i),o.lat,o.lng); if(n.set) r.nextSet=n.set; } }
  return r;
}
function sunPosLine(o,date,min){
  const w=atKst(date,min), pos=SC.getPosition(w,o.lat,o.lng), alt=pos.altitude*180/Math.PI, az=compass(pos.azimuth);
  return alt>0 ? `고도 <b class="num">${alt.toFixed(1)}°</b> · 방위 <b class="num">${Math.round(az)}°</b> ${dirName(az)}` : `<span class="below">지평선 아래 (고도 ${alt.toFixed(1)}°) · 방위 ${Math.round(az)}° ${dirName(az)}</span>`;
}
function moonPosLine(o,date,min){
  const w=atKst(date,min), p=MOON.position(w,o.lat,o.lng);
  return p.alt>0 ? `고도 <b class="num">${p.alt.toFixed(1)}°</b> · 방위 <b class="num">${Math.round(p.az)}°</b> ${dirName(p.az)}` : `<span class="below">지평선 아래 (고도 ${p.alt.toFixed(1)}°) · 방위 ${Math.round(p.az)}° ${dirName(p.az)}</span>`;
}
function moonNowHTML(date,min){
  const w=atKst(date,min), ph=MOON.phaseInfo(w);
  return `${moonSVG(ph.frac,ph.waxing,56)}<div style="display:grid;gap:2px"><span class="ph">${esc(ph.name)}</span><span class="meta">밝은 면 <b class="num">${Math.round(ph.frac*100)}%</b> · ${ph.waxing?"차오르는 중":"기우는 중"}</span><span class="meta">월령 약 <b class="num">${ph.age!=null?ph.age.toFixed(1):"—"}</b>일 (직전 삭 ${fmtDT(ph.prevNew)}부터, 근삿값)</span><span class="fine">기준 시각 ${fmtT(w)} (아래 시각 막대와 같음)</span></div>`;
}
const PH_NAMES={0:"삭",90:"상현",180:"보름",270:"하현"};
function phaseEvents(fromD, toD){
  const out=[];
  for (const tg of [0,90,180,270]){ let t=new Date(fromD.getTime()); for(let k=0;k<3;k++){ const e=MOON.nextPhase(t,tg); if(!e||e>toD) break; out.push({tg,at:e}); t=new Date(e.getTime()+864e5); } }
  return out.sort((a,b)=>a.at-b.at);
}
function calHTML(sel){
  const ym=S.calMonth||sel.slice(0,7), [y,m]=ym.split("-").map(Number);
  const first=new Date(Date.UTC(y,m-1,1)), days=new Date(Date.UTC(y,m,0)).getUTCDate(), dow=first.getUTCDay();
  const evs=phaseEvents(new Date(`${ym}-01T00:00:00+09:00`), new Date(new Date(`${ym}-${String(days).padStart(2,"0")}T23:59:59+09:00`)));
  const evBy=new Map(); evs.forEach(e=>{ const k=SEOUL_DATE.format(e.at); evBy.set(k,(evBy.get(k)||"")+`${PH_NAMES[e.tg]} ${fmtT(e.at)}`); });
  const cells=[];
  for (let i=0;i<dow;i++) cells.push(`<span></span>`);
  for (let dd=1; dd<=days; dd++){
    const ds=`${ym}-${String(dd).padStart(2,"0")}`, w=atKst(ds,21*60), k=MOON.illum(w), wx=MOON.elong(w)<180;
    cells.push(`<button type="button" data-act="cal-pick" data-d="${ds}" aria-pressed="${ds===sel}" class="${ds===today()?"today":""}" aria-label="${m}월 ${dd}일, 밝은 면 ${Math.round(k*100)}%${evBy.get(ds)?", "+evBy.get(ds):""}"><span class="dn">${dd}</span>${moonSVG(k,wx,18)}${evBy.get(ds)?`<span class="ev">${esc(evBy.get(ds))}</span>`:""}</button>`);
  }
  return `<div class="cal"><div class="calhead"><button type="button" class="btn small nav" data-act="cal-mon" data-n="-1" aria-label="이전 달">‹</button><b>${y}년 ${m}월</b><button type="button" class="btn small nav" data-act="cal-mon" data-n="1" aria-label="다음 달">›</button></div>
    <div class="calgrid">${["일","월","화","수","목","금","토"].map(x=>`<span class="dow">${x}</span>`).join("")}${cells.join("")}</div>
    <p class="fine" style="margin:6px 0 0">각 날짜의 달 모양은 그날 21:00 기준이에요. 날짜 아래 ‘보름 22:19’ 같은 표시는 계산한 정확한 위상 순간이고, 그 앞뒤 하루 이틀도 보름에 가까운 모양이에요. 음력 날짜와는 다른 값이에요.</p></div>`;
}
function astroInner(o, where){
  if (!o) return `<h3>해·달</h3><p class="fine">관측 위치가 없어요. 좌표가 있는 출사지를 고르거나 ‘지도에서 관측 위치 지정’을 누르세요.</p><div><button type="button" class="btn small" data-act="obs-pick" ${MAP.state==="ready"?"":"disabled"}>지도에서 관측 위치 지정</button></div>`;
  const date=S.sun.date||today(), t=sunDay(o,date), sm=selMin(t,date), mr=moonRS(o,date);
  const pc=d=>(kstMin(d)/1440*100).toFixed(2);
  const seg=(a,b,c)=> (a&&b&&isFinite(a)&&isFinite(b)) ? `<span style="left:${pc(a)}%;width:${Math.max(0,pc(b)-pc(a)).toFixed(2)}%;background:${c}"></span>` : "";
  const yr=+date.slice(0,4), mo=+date.slice(5,7);
  const rowsM=Array.from({length:12},(_,i)=>{ const ds=`${yr}-${String(i+1).padStart(2,"0")}-15`, x=sunDay(o,ds); return `<tr class="${i+1===mo?"cur":""}"><td>${i+1}월 15일</td><td class="r">${fmtT(x.sunrise)}</td><td class="s">${fmtT(x.sunset)}</td><td>${fmtT(x.goldStartE)}</td><td>${Math.round(x.setAz)}°</td><td>${dur(x.dayMin)}</td></tr>`; }).join("");
  const now=atKst(date,sm), evs=phaseEvents(now,new Date(now.getTime()+40*864e5)).slice(0,4);
  const mrCell=(when,az,next,kind)=> when ? `<div class="v mr">${fmtT(when)}</div><div class="s">방위 ${Math.round(az)}° ${dirName(az)}</div>` : `<div class="v sm">없음</div><div class="s">${mr.alwaysUp?"하루 종일 지평선 위":mr.alwaysDown?"하루 종일 지평선 아래":`이 날 ${kind} 없음`}${next?` · 다음 ${fmtDT(next)}`:""}</div>`;
  return `<h3>해·달</h3>
    <div class="obsline"><span class="obsdot" aria-hidden="true"></span><span class="grow"><b>관측 위치</b> ${esc(o.name)} <span class="meta">${o.kind==="custom"?"(지도에서 지정)":"(출사지)"}</span><br><span class="coord">${o.lat.toFixed(5)}, ${o.lng.toFixed(5)} · 시간대 Asia/Seoul (UTC+9)</span></span>
      <button type="button" class="btn small" data-act="obs-pick" ${MAP.state==="ready"?"":"disabled"}>지도에서 다른 위치</button>${o.kind==="custom"?`<button type="button" class="btn small ghost" data-act="obs-clear">출사지로 되돌리기</button>`:""}</div>
    <div class="datebar"><button type="button" class="btn small nav" data-act="day" data-n="-1" aria-label="전날">‹</button><label class="sr" for="ad-${where}">날짜</label><input type="date" id="ad-${where}" class="a-date" value="${date}"><button type="button" class="btn small nav" data-act="day" data-n="1" aria-label="다음 날">›</button><button type="button" class="btn small" data-act="sun-today">오늘</button><button type="button" class="btn small" data-act="cal-toggle" aria-expanded="${S.calOpen}">달 달력</button></div>
    ${S.calOpen?calHTML(date):""}
    <div class="chiprow"><span class="seg" role="group" aria-label="지도 방향선 표시"><button type="button" data-act="amode" data-v="sun" aria-pressed="${S.astroMode==="sun"}">해</button><button type="button" data-act="amode" data-v="moon" aria-pressed="${S.astroMode==="moon"}">달</button><button type="button" data-act="amode" data-v="both" aria-pressed="${S.astroMode==="both"}">함께 보기</button></span></div>
    <div class="a-sun" style="display:grid;gap:8px">
    <div class="suncards">
      <div class="sc"><div class="k">일출</div><div class="v rise">${fmtT(t.sunrise)}</div><div class="s">방위 ${Math.round(t.riseAz)}° ${dirName(t.riseAz)}</div></div>
      <div class="sc"><div class="k">일몰</div><div class="v set">${fmtT(t.sunset)}</div><div class="s">방위 ${Math.round(t.setAz)}° ${dirName(t.setAz)}</div></div>
      <div class="sc"><div class="k">아침 골든아워</div><div class="v sm">${fmtT(t.blueEndM)}–${fmtT(t.goldEndM)}</div><div class="s">블루아워 ${fmtT(t.dawn)}–${fmtT(t.blueEndM)}</div></div>
      <div class="sc"><div class="k">저녁 골든아워</div><div class="v sm">${fmtT(t.goldStartE)}–${fmtT(t.blueStartE)}</div><div class="s">블루아워 ${fmtT(t.blueStartE)}–${fmtT(t.dusk)}</div></div>
    </div>
    <div class="daybar" aria-hidden="true">${seg(t.dawn,t.blueEndM,"var(--moon)")}${seg(t.blueEndM,t.goldEndM,"var(--sun)")}${seg(t.goldEndM,t.goldStartE,"var(--accent-soft)")}${seg(t.goldStartE,t.blueStartE,"var(--sun)")}${seg(t.blueStartE,t.dusk,"var(--moon)")}<span class="now a-now" style="left:${(sm/1440*100).toFixed(2)}%"></span></div>
    <div class="ticks"><span>00</span><span>06</span><span>12</span><span>18</span><span>24</span></div>
    </div>
    <details class="a-more"${S.astroMore||S.astroMode==="moon"?" open":""}><summary>시각별 위치 · 달 · 월별 비교</summary><div class="a-more-body">
    <div class="timerow"><label for="am-${where}">시각</label><input type="range" id="am-${where}" class="a-min" min="0" max="1435" step="5" value="${sm}"><span class="mono a-t">${fmtT(atKst(date,sm))}</span></div>
    <div class="posline a-sun"><span class="k">해</span><span class="a-sunpos">${sunPosLine(o,date,sm)}</span></div>
    <div class="posline a-moon"><span class="k">달</span><span class="a-moonpos">${moonPosLine(o,date,sm)}</span></div>
    <div class="a-moon" style="display:grid;gap:8px">
      <div class="mooncards suncards">
        <div class="sc"><div class="k">월출</div>${mrCell(mr.rise,mr.riseAz,mr.nextRise,"월출")}</div>
        <div class="sc"><div class="k">월몰</div>${mrCell(mr.set,mr.setAz,mr.nextSet,"월몰")}</div>
      </div>
      <div class="moonnow a-moonnow">${moonNowHTML(date,sm)}</div>
      <div><div class="fine" style="margin-bottom:4px">다음 위상 순간 (계산값, 한국 시각)</div><ul class="phlist">${evs.map(e=>`<li>${moonSVG(e.tg===0?0:e.tg===180?1:0.5,e.tg<180,16)}<b>${PH_NAMES[e.tg]}</b><span class="t">${fmtDT(e.at)}</span></li>`).join("")}</ul></div>
    </div>
    <p class="fine a-sun">낮 길이 ${dur(t.dayMin)} · 태양 남중 ${fmtT(t.solarNoon)}</p>
    <details class="a-sun"><summary class="fine" style="cursor:pointer">월별 해 비교 (${yr}년 각 달 15일 기준)</summary>
      <table class="season"><thead><tr><th>기준일</th><th>일출</th><th>일몰</th><th>저녁 골든</th><th>일몰 방위</th><th>낮 길이</th></tr></thead><tbody>${rowsM}</tbody></table>
    </details>
    <details><summary class="fine" style="cursor:pointer">계산 기준과 한계</summary>
    <p class="fine">해: SunCalc 알고리즘. 일출·일몰은 해 윗가장자리가 지평선에 닿는 순간(고도 −0.833°, 대기굴절 34′와 해 반지름 16′ 포함), 골든아워는 해 고도 −4°~+6°, 블루아워는 −6°~−4°예요.</p>
    <p class="fine">달: Meeus 『Astronomical Algorithms』 방식. 월출·월몰은 달 윗가장자리가 지평선에 닿는 순간(대기굴절 34′, 달 반지름, 지평시차 반영)이고, 그날 00:00~24:00(한국 시각) 안에 없으면 ‘없음’으로 표시해요. 달은 매일 약 50분씩 늦게 떠서 한 달에 하루쯤 월출이나 월몰이 없는 날이 있어요. 시각별 고도는 관측자 위치 기준(시차·대기굴절 반영)이에요. 위상 이름은 해와 달의 황경 차로 나눈 구간이고, ‘무렵’은 정확한 위상 순간이 아니라 그 모양에 가깝다는 뜻이에요. 월령은 직전 삭부터 지난 날수예요. 달 모양 그림은 밝은 면 비율만 반영하고 기울기는 반영하지 않아요.</p>
    <p class="fine">방위각은 모두 정북 0°, 정동 90°, 정남 180°, 정서 270° 기준이에요. 산·건물·지형·구름은 반영하지 않은 천문 계산값이라, 실제로 해나 달이 보이는 시각은 몇 분에서 수십 분 늦을 수 있어요. 가시성을 예측하는 기능이 아니에요.</p></details>
    </div></details>`;
}
function astroSection(o, where){ return `<section class="dsec astro" data-obs="${where}" data-mode="${S.astroMode}" aria-label="해·달">${astroInner(o,where)}</section>`; }
function sheetAstroHTML(){
  const o=curObs();
  const dup = o && o.kind==="place" && !isMobile() && !$("#detailView").hidden;
  if (dup) return `<p class="fine" style="margin:0">선택한 출사지 ‘${esc(o.name)}’의 해·달 정보는 왼쪽 상세 화면에 있어요. 지도에는 그 위치 기준 방향선이 그려져요.</p><div><button type="button" class="btn small" data-act="obs-pick" ${MAP.state==="ready"?"":"disabled"}>지도에서 다른 관측 위치 지정</button></div>`;
  return astroSection(o,"sheet");
}
// ‘자세히’를 열고 닫은 상태를 기억해, 날짜·시각을 바꿔 다시 그려도 그대로 유지
S.astroMore=false;
document.addEventListener("toggle",e=>{ if(e.target.matches?.("details.a-more")) S.astroMore=e.target.open; },true);
function rerenderAstro(){
  document.querySelectorAll(".astro").forEach(root=>{ root.dataset.mode=S.astroMode; root.innerHTML=astroInner(obsFor(root), root.dataset.obs); });
  syncSunOnMap();
}
function quickAstro(){
  const date=S.sun.date||today();
  document.querySelectorAll(".astro").forEach(root=>{
    const o=obsFor(root); if(!o) return; const t=sunDay(o,date), sm=selMin(t,date);
    root.querySelectorAll(".a-min").forEach(x=>{ if(+x.value!==sm) x.value=sm; });
    const set=(sel,h)=>{ const el=root.querySelector(sel); if(el) el.innerHTML=h; };
    set(".a-t",fmtT(atKst(date,sm))); set(".a-sunpos",sunPosLine(o,date,sm)); set(".a-moonpos",moonPosLine(o,date,sm)); set(".a-moonnow",moonNowHTML(date,sm));
    const n=root.querySelector(".a-now"); if(n) n.style.left=(sm/1440*100).toFixed(2)+"%";
  });
}

/* =====================================================================
   20. 테마(시스템·라이트·다크) — 화면 토큰과 배경 지도 스타일을 함께 바꿈. 지도 시점·선택·경로·날짜는 유지
   ===================================================================== */
const THEME_LABEL={system:"시스템",light:"라이트",dark:"다크"};
S.theme = "system";
function effTheme(){ return S.theme==="system" ? (matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light") : S.theme; }
/* ThemeToggle(design-system/components/ThemeToggle): 라이트·다크·시스템 세그먼트. 기본은 시스템(<html>에 data-theme 없음) */
const THEME_KEY="photo-map-theme";
function applyTheme(t, persist){
  S.theme=t;
  if (t==="system") document.documentElement.removeAttribute("data-theme"); else document.documentElement.setAttribute("data-theme",t);
  if (persist){ try { localStorage.setItem(THEME_KEY,t); } catch(e){} }
  document.querySelectorAll('#themeToggle [role=radio]').forEach(b=>{ const on=b.dataset.theme===t; b.setAttribute("aria-checked",String(on)); b.tabIndex=on?0:-1; });
  applyMapTheme();
}
/* 화면 모드가 바뀌면: 스타일을 다시 불러오지 않고 배경 지도 색만 map-paint JSON으로 덮어쓴 뒤, 앱이 그린 레이어(철도·마커·해달) 색을 토큰에서 다시 읽음 */
function applyMapTheme(){
  if (!MAP.m || MAP.state!=="ready") return;
  const want=effTheme();
  if (MAP.mode==="basic"){ try { MAP.m.setPaintProperty("bg","background-color",cssVar("--map-land")); } catch(e){} }
  else if (MAP.styleTheme!==want || !MAP.painted){ applyPhotoMapStyle(MAP.m, want); quietBase(MAP.m); }
  MAP.styleTheme=want; MAP.painted=true;
  themeRefreshRail(); syncMarkers(); syncSunOnMap();
}
$("#themeToggle").addEventListener("click",e=>{ const b=e.target.closest("[role=radio]"); if(b) applyTheme(b.dataset.theme,true); });
// 화살표 키로 고르기(radiogroup 관례)
$("#themeToggle").addEventListener("keydown",e=>{
  if (!["ArrowLeft","ArrowRight","ArrowUp","ArrowDown"].includes(e.key)) return;
  const bs=[...$("#themeToggle").querySelectorAll("[role=radio]")], i=bs.findIndex(b=>b.dataset.theme===S.theme), d=(e.key==="ArrowLeft"||e.key==="ArrowUp")?-1:1;
  const nb=bs[(i+d+bs.length)%bs.length]; e.preventDefault(); applyTheme(nb.dataset.theme,true); nb.focus();
});
matchMedia("(prefers-color-scheme: dark)").addEventListener("change",()=>{ if(S.theme==="system") applyMapTheme(); });

/* 시트·경로·해달 공통 이벤트 */
$("#sheetHandle").addEventListener("click",()=>{ S.sheetOpen=true; renderSheet(); $("#toolSheet").querySelector(`[data-tab="${S.sheetTab}"]`)?.focus(); });
$("#toolSheet").addEventListener("click",e=>{
  const tb=e.target.closest("[data-tab]");
  if (tb){ S.sheetTab=tb.dataset.tab; S.sheetOpen=true; RAIL.sugg=null; renderSheet(); return; }
  if (e.target.closest("#sheetX")){ S.sheetOpen=false; renderSheet(); $("#sheetHandle").focus(); return; }
});
document.addEventListener("click",e=>{
  const t=e.target.closest("[data-act]"); if(!t) return;
  const a=t.dataset.act;
  if (a==="rail-retry") loadRail();
  else if (a==="rail-toggle"){ MAP.app.rail=!MAP.app.rail; saveLayerPrefs(); renderLayerChips(); syncRail(); renderSheet(); }
  else if (a==="ln-all"){ RAIL.hidden.clear(); railPrefsSave(); syncRail(); renderSheet(); if(RAIL.from!=null&&RAIL.to!=null) runRoute(); }
  else if (a==="ln-none"){ RAIL.d.lines.forEach(l=>RAIL.hidden.add(l.id)); RAIL.focus=null; railPrefsSave(); syncRail(); renderSheet(); }
  else if (a==="ln-focus"){ const li=+t.dataset.li; RAIL.focus = RAIL.focus===li?null:li; if(RAIL.focus!=null) RAIL.hidden.delete(RAIL.d.lines[li].id); syncRail(); renderSheet(); if(RAIL.focus!=null) fitLine(li); }
  else if (a==="ln-unfocus"){ RAIL.focus=null; syncRail(); renderSheet(); }
  else if (a==="rt-from"||a==="rt-to"){ const which=a==="rt-from"?"from":"to"; RAIL[which]=+t.dataset.st; RAIL.q[which]=""; RAIL.sugg=null; MAP.stPop?.remove(); S.sheetTab="route"; S.sheetOpen=true; if(isMobile()&&a==="rt-to"&&t.closest("#detailBody")){ setView("map"); } runRoute(); }
  else if (a==="rt-pick"){ const w=t.dataset.which; RAIL[w]=+t.dataset.st; RAIL.q[w]=""; RAIL.sugg=null; runRoute(); }
  else if (a==="rt-swap"){ [RAIL.from,RAIL.to]=[RAIL.to,RAIL.from]; [RAIL.q.from,RAIL.q.to]=[RAIL.q.to,RAIL.q.from]; runRoute(); }
  else if (a==="rt-clear"){ RAIL.from=RAIL.to=null; RAIL.q={from:"",to:""}; RAIL.route=null; RAIL.routeMsg=""; RAIL.sugg=null; renderSheet(); syncRail(); }
  else if (a==="rt-crit"){ RAIL.crit=t.dataset.v; railPrefsSave(); runRoute(); }
  else if (a==="obs-pick"){
    const ok=startPick(ll=>{ S.obsCustom={lat:+ll.lat.toFixed(6),lng:+ll.lng.toFixed(6),name:"지도에서 고른 지점",kind:"custom"}; S.sheetTab="astro"; S.sheetOpen=true; renderSheet(); rerenderAstro(); toast("관측 위치를 바꿨어요"); }, "해·달을 볼 관측 위치를 지도에서 눌러 주세요.");
    if (!ok) toast("지도가 표시되지 않아 지도에서 고를 수 없어요",true);
  }
  else if (a==="obs-clear"){ S.obsCustom=null; renderSheet(); rerenderAstro(); }
  else if (a==="day"){ S.sun.date=addDays(S.sun.date||today(),+t.dataset.n); S.sun.min=S.sun.min; S.calMonth=null; rerenderAstro(); }
  else if (a==="cal-toggle"){ S.calOpen=!S.calOpen; S.calMonth=null; rerenderAstro(); }
  else if (a==="cal-mon"){ const base=(S.calMonth||(S.sun.date||today()).slice(0,7))+"-15"; S.calMonth=addDays(base,+t.dataset.n*30).slice(0,7); rerenderAstro(); }
  else if (a==="cal-pick"){ S.sun.date=t.dataset.d; S.calMonth=t.dataset.d.slice(0,7); rerenderAstro(); }
  else if (a==="amode"){ S.astroMode=t.dataset.v; rerenderAstro(); }
});
document.addEventListener("input",e=>{
  const t=e.target;
  if (t.classList && t.classList.contains("a-min")){ S.sun.min=+t.value; quickAstro(); cancelAnimationFrame(sunRaf); sunRaf=requestAnimationFrame(syncSunOnMap); }
  else if (t.dataset && t.dataset.rtq){ const w=t.dataset.rtq; RAIL.q[w]=t.value; RAIL[w]=null; RAIL.route=null; RAIL.routeMsg=""; RAIL.sugg=w; syncRail(); renderSheet(); const el=document.getElementById("rt-"+w); if(el){ el.focus(); el.setSelectionRange(el.value.length,el.value.length); } }
});
document.addEventListener("change",e=>{
  const t=e.target;
  if (t.classList && t.classList.contains("a-date") && /^\d{4}-\d{2}-\d{2}$/.test(t.value)){ S.sun.date=t.value; S.calMonth=null; rerenderAstro(); }
  else if (t.id==="rtUnver"){ RAIL.allowUnver=t.checked; runRoute(); }
  else if (t.dataset && t.dataset.ln){ const id=t.dataset.ln; t.checked?RAIL.hidden.delete(id):RAIL.hidden.add(id); if(RAIL.focus!=null&&RAIL.hidden.has(RAIL.d.lines[RAIL.focus].id)) RAIL.focus=null; railPrefsSave(); syncRail(); renderSheet(); if(RAIL.from!=null&&RAIL.to!=null) runRoute(); }
});
function fitLine(li){
  if (!MAP.m || MAP.state!=="ready") return;
  const b=new maplibregl.LngLatBounds(); RAIL.d.lines[li].geom.forEach(g=>g.forEach(c=>b.extend(c)));
  MAP.m.fitBounds(b,{padding:isMobile()?{top:70,bottom:Math.round(innerHeight*0.5),left:30,right:40}:{top:70,bottom:60,left:50,right:420},maxZoom:13,duration:0});
}

/* =====================================================================
   21. 공개 데이터 — data/places.json · data/photos.json 을 읽기만 함.
       이 페이지에는 저장·편집·토큰이 없음. 올리기는 admin.html에서.
   ===================================================================== */
function recordFromPublic(r, sources, checked){
  const raw={};
  for (const [k,e] of Object.entries(r.res||{})){
    // 공개 형식: [종류, 값, 출처ID들, 확인일] — 조사 메모 칸 없음
    raw[k]=[e[0], e[1], e[2]||[], null, e[3]||null];
  }
  return { id:r.id, src:r.src||{}, res:expandResearch(raw, sources||{}, checked), man:r.man||{},
    memo:r.memo||null, memoPublic:!!r.memo, visits:(r.visits||[]).map(v=>({...v,public:true})),
    public:r.public!==false, review:r.review||null, links:r.links||{}, markerTheme:r.markerTheme };
}
class PublicStore {
  constructor(){ this.mode="public"; this.canWrite=false; this.flat=true; }
  async fetchJSON(u){
    let r;
    try { r=await fetch(u,{cache:"no-cache"}); } catch(e){ throw new Error(`${u}에 연결하지 못했어요 (${e.message||"네트워크 오류"})`); }
    if (!r.ok) throw new Error(`${u}를 받지 못했어요 (HTTP ${r.status})`);
    return await r.json();
  }
  async loadAll(){
    const [P,F]=await Promise.all([this.fetchJSON(DATA_URL.places), this.fetchJSON(DATA_URL.photos).catch(e=>{ console.warn(e); return {photos:[]}; })]);
    const places=(P.places||[]).filter(r=>r.public!==false).map(r=>{ const p=flatten(recordFromPublic(r,P.sources,P.checked)); if(r.markerTheme) p.markerTheme=r.markerTheme; return p; });
    const ids=new Set(places.map(p=>p.id));
    const photos=(F.photos||[]).filter(x=>ids.has(x.placeId)).map(x=>({id:x.id, placeId:x.placeId, fullRef:x.full, thumbRef:x.thumb||x.full, w:x.w, h:x.h,
      caption:x.caption||"", takenAt:x.takenAt||"", season:x.season||"", time:x.time||"", shot:x.shot||"", order:x.order||0, cover:!!x.cover, public:true}));
    this.updatedAt=[P.updatedAt,F.updatedAt].filter(Boolean).sort().pop()||null;
    return {places, archive:[], photos};
  }
  async url(ref){ return ref || null; }
  async getMeta(){ return null; }
}
function setStatus(){ const el=$("#statusBtn"); if(el) el.hidden=true; }

/* 사진 보호: 사진 위 우클릭·길게 누르기 메뉴·끌어 놓기 저장을 막음 (완전한 차단은 불가능하다는 점은 안내에 적음) */
document.addEventListener("contextmenu",e=>{ if (e.target.closest("img, .gallery, .lightbox, .thumb")) e.preventDefault(); });
document.addEventListener("dragstart",e=>{ if (e.target.closest && e.target.closest("img")) e.preventDefault(); });

async function boot(){
  let th="system"; try { th=localStorage.getItem(THEME_KEY)||localStorage.getItem("spm-theme")||"system"; } catch(e){}
  applyTheme(["system","light","dark"].includes(th)?th:"system", false);
  loadLayerPrefs(); railPrefsLoad();
  setView("list"); S.sun.date=today();
  document.querySelector('.brand p').textContent="출사지 정보와 철도망·해와 달을 한곳에서";
  S.store=new PublicStore(); setStatus();
  renderSheet(); initMap(); loadRail();
  const ls=$("#loadState");
  try {
    S.stored=await S.store.loadAll();
    ls.hidden=true;
  } catch(e){
    console.error(e);
    ls.innerHTML=`<strong>장소 목록을 불러오지 못했어요.</strong> ${esc(e.message||String(e))} <button type="button" class="btn small" onclick="location.reload()">다시 시도</button>`;
    ls.classList.add("err");
  }
  mergePlaces(); renderAll();
}
boot();
