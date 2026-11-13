/* ============================================================================
 * 나폴리탄 14종 라벨 만들기 — 한 번에 붙여넣는 파일
 * ----------------------------------------------------------------------------
 * 쓰는 법
 *   1. 라벨에디터(label.o2veluto.com)에 로그인한 채로 F12 를 누릅니다
 *   2. Console 탭에 이 파일 전체를 붙여넣고 Enter
 *   3. 화면이 시키는 대로 한 줄씩 입력하면 됩니다
 * ========================================================================== */
(async () => {
  'use strict';

/* ===== 1부 — 로그인 확인 ================================================= */
  'use strict';

  const PROJECT = 'svcnbqyetbenavwxakmn';
  const B = `https://${PROJECT}.supabase.co/rest/v1/`;
  const STORAGE_KEY = `sb-${PROJECT}-auth-token`;

  const b64url = (s) => {
    s = s.replace(/-/g, '+').replace(/_/g, '/');
    return atob(s + '='.repeat((4 - (s.length % 4)) % 4));
  };
  const jwtPayload = (t) => JSON.parse(b64url(t.split('.')[1]));

  /* ---- 1) access_token / UID ---------------------------------------------- */
  const raw = localStorage.getItem(STORAGE_KEY) || sessionStorage.getItem(STORAGE_KEY);
  if (!raw) {
    throw new Error(
      '라벨에디터에 로그인이 되어 있지 않습니다.\n' +
      '       label.o2veluto.com 에서 로그인을 먼저 하신 뒤,\n' +
      '       그 화면에서 다시 붙여넣어 주세요. (시크릿창에서는 안 됩니다)'
    );
  }

  let sess;
  try { sess = JSON.parse(raw); }
  catch (e) { throw new Error('[auth] 세션 JSON 파싱 실패: ' + e.message); }
  if (Array.isArray(sess)) sess = sess[0];            // supabase-js 버전별 저장 형태 대응
  if (sess && sess.currentSession) sess = sess.currentSession;

  const TOKEN = sess?.access_token;
  if (!TOKEN) throw new Error('로그인 정보를 읽지 못했습니다. 라벨에디터에서 로그아웃 후 다시 로그인해 주세요.');

  const payload = jwtPayload(TOKEN);
  const UID   = sess?.user?.id   ?? payload.sub;
  const EMAIL = sess?.user?.email ?? payload.email ?? null;
  const expiresAt = new Date(payload.exp * 1000);
  const minsLeft  = Math.round((expiresAt - Date.now()) / 60000);

  if (minsLeft <= 0) {
    throw new Error(`로그인이 만료되었습니다 (${expiresAt.toLocaleString()}). 라벨에디터 화면을 새로고침한 뒤 다시 해주세요.`);
  }

  /* ---- 2) anon(publishable) key — 번들 스크립트에서 추출 -------------------- */
  let ANON = null;

  // 2-a) 페이지가 전역에 노출한 경우를 먼저 본다 (가장 빠름)
  for (const k of ['SUPABASE_ANON_KEY', '__SUPABASE_ANON_KEY__', 'supabaseKey']) {
    const v = window[k];
    if (typeof v === 'string' && /^(sb_publishable_|eyJ)/.test(v)) { ANON = v; break; }
  }

  // 2-b) 로드된 JS 번들 전수 스캔 (MD 5-1 방식)
  if (!ANON) {
    const urls = performance.getEntriesByType('resource')
      .map(e => e.name)
      .filter(u => /\.(js|mjs)(\?|$)/.test(u));

    for (const u of urls) {
      let txt;
      try { txt = await (await fetch(u)).text(); } catch { continue; }
      const m = txt.match(/sb_publishable_[A-Za-z0-9_-]+/)
             || txt.match(/eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{40,}\.[A-Za-z0-9_-]{20,}/);
      if (m) { ANON = m[0]; console.log('[auth] anon key 출처:', u); break; }
    }
  }

  if (!ANON) {
    throw new Error(
      '[auth] anon key 를 번들에서 찾지 못했습니다.\n' +
      '       Network 탭에서 supabase.co 요청 하나를 열어 Request Headers 의 `apikey` 값을 복사한 뒤\n' +
      '       window.LE_ANON_OVERRIDE = "<값>" 을 먼저 실행하고 이 스크립트를 다시 돌리세요.'
    );
  }
  if (window.LE_ANON_OVERRIDE) ANON = window.LE_ANON_OVERRIDE;

  // anon key 가 실수로 access_token 인지 방어 (MD 5-1 주의사항)
  if (ANON === TOKEN) {
    throw new Error('[auth] anon key 자리에 access_token 이 들어왔습니다. 401 이 납니다. 중단합니다.');
  }

  const H = {
    apikey: ANON,
    authorization: 'Bearer ' + TOKEN,
    'accept-profile': 'public',
  };

  /* ---- 3) 헤더가 실제로 먹는지 확인 --------------------------------------- */
  const check = async () => {
    const r = await fetch(B + 'label_folders?select=id&limit=1', { headers: H });
    const body = await r.text();
    if (!r.ok) throw new Error(`[auth] 확인 실패 HTTP ${r.status}: ${body.slice(0, 300)}`);
    return true;
  };

  await check();

  window.LE_AUTH = { ANON, TOKEN, UID, EMAIL, expiresAt, H, B, PROJECT, check };

  console.log(
    '%c[auth] OK',
    'color:#0a0;font-weight:bold',
    `\n  user      : ${EMAIL} (${UID})` +
    `\n  token exp : ${expiresAt.toLocaleString()}  (약 ${minsLeft}분 남음)` +
    `\n  anon      : ${ANON.slice(0, 18)}…` +
    `\n\n  다음: 02_core.js 를 붙여넣으세요.`
  );
  if (minsLeft < 15) {
    console.warn(`[auth] 토큰 잔여 ${minsLeft}분. 긴 작업 전에 페이지를 새로고침해 토큰을 갱신하세요.`);
  }

/* ===== 2부 — 기본 기능 =================================================== */
/* ============================================================================
 * 02_core.js — 라벨에디터 구동 코어  (MD 2·3·4·5 단계)
 * ----------------------------------------------------------------------------
 * 전제: 01_auth.js 를 먼저 실행해 window.LE_AUTH 가 있어야 한다.
 * 결과: window.LE  (아래 "공개 API" 참고)
 *
 * 설계 원칙
 *  1) form_data 내부 스키마를 추측하지 않는다.
 *     MD 문서에 확정된 것은 6블록 이름과 productInfo 의 날짜 2개뿐이다.
 *     나머지 필드 경로는 LE.dumpSchema() / LE.findPath() 로 "기존 라벨에서 발견"한다.
 *  2) 쓰기는 2단계. LE.plan*() 는 절대 쓰지 않고, LE.apply(plan,{confirm:'CREATE'}) 만 POST 한다.
 *  3) 경로 오타는 조용히 넘어가지 않는다. 없는 경로에 set 하면 throw (새 필드가 만들어져
 *     화면에 안 찍히는 사고를 막는다).
 * ========================================================================== */
(() => {
  'use strict';

  /* ===== 0. 상수 ========================================================== */

  const FOLDER_CHOCO_ORDER = '843622a3-ef46-4a7a-9cf1-8df2b3aaa0fd';  // 초콜릿발주
  const CARD_ORDER = 'position.asc,created_at.desc';                  // MD 6-1: 클릭/다운로드 순서와 일치

  /* ===== 1. 규칙 (MD 4장) ================================================= */

  const RULES = {
    // 계열 판정. 매칭 실패 시 throw — 추측하지 않는다.
    series: [
      { id: 'white',    label: '화이트',    test: /^DHT-(LM|VL)W/i, shelfLifeMonths: 12, hsCode: '1704.90-9000' },
      { id: 'darkmilk', label: '다크·밀크', test: /^DHT-(LM|VL)[DM]/i, shelfLifeMonths: 18, hsCode: '1806.20-1000' },
    ],
    // MD 4-3: 10kg 카톤 라벨을 쓰는 품목은 벨벳 58% 다크 / 벨벳 40% 화이트 2종뿐 (2026-10-28 확인)
    cartonEligible: [/^DHT-VLD58/i, /^DHT-VLW40/i],
  };

  // form_data 내부 경로. 기본값 null = "아직 발견되지 않음".
  // LE.discoverPaths(templateLabel) 로 채우거나 직접 지정한다.
  // productInfo 의 두 날짜만 MD 3장에서 확정된 값.
  const PATHS = {
    mfgDate:   'productInfo.expiryDate',   // !! 제조일   (이름에 속지 말 것)
    bestBy:    'productInfo.bestByDate',   // !! 소비기한 (이름에 속지 말 것)
    netWeight: null,                       // 내용량  — discoverPaths 로 발견
    hsCode:    null,                       // HS CODE — discoverPaths 로 발견
  };

  /* ===== 2. 유틸 ========================================================== */

  const auth = () => {
    if (!window.LE_AUTH) throw new Error('[core] 01_auth.js 를 먼저 실행하세요.');
    if (window.LE_AUTH.expiresAt <= new Date())
      throw new Error('[core] 토큰이 만료되었습니다. 페이지 새로고침 후 01_auth.js 를 다시 실행하세요.');
    return window.LE_AUTH;
  };

  const req = async (path, opts = {}) => {
    const { H, B } = auth();
    const r = await fetch(B + path, { ...opts, headers: { ...H, ...(opts.headers || {}) } });
    const txt = await r.text();
    if (!r.ok) throw new Error(`[core] HTTP ${r.status} — ${path}\n${txt.slice(0, 600)}`);
    return txt ? JSON.parse(txt) : null;
  };

  const writeHeaders = { 'content-type': 'application/json', prefer: 'return=representation' };
  const deep  = (o) => JSON.parse(JSON.stringify(o));
  const iso   = (d) => d.toISOString().slice(0, 10);
  const today = () => iso(new Date());

  /* --- 경로 접근 (a.b[0].c) --- */
  const toks = (p) => {
    const out = [];
    const re = /([^.[\]]+)|\[(\d+)\]/g;
    let m;
    while ((m = re.exec(p))) out.push(m[2] !== undefined ? Number(m[2]) : m[1]);
    return out;
  };

  const getPath = (obj, p) => toks(p).reduce((a, k) => (a == null ? a : a[k]), obj);

  const setPath = (obj, p, val, { create = false } = {}) => {
    const t = toks(p);
    let cur = obj;
    for (let i = 0; i < t.length - 1; i++) {
      if (cur[t[i]] == null) {
        if (!create) throw new Error(`[core] 경로 없음: "${p}" (…${t.slice(0, i + 1).join('.')} 이 null/undefined). 오타이거나 템플릿에 그 필드가 없습니다.`);
        cur[t[i]] = typeof t[i + 1] === 'number' ? [] : {};
      }
      cur = cur[t[i]];
    }
    const last = t[t.length - 1];
    if (!create && !(last in cur))
      throw new Error(`[core] 경로 없음: "${p}". LE.dumpSchema() 로 실제 필드명을 확인하세요.`);
    const before = cur[last];
    cur[last] = val;
    return before;
  };

  /* --- 스키마 평탄화 --- */
  const flatten = (obj, prefix = '', out = {}) => {
    if (obj === null || typeof obj !== 'object') { out[prefix] = obj; return out; }
    if (Array.isArray(obj)) {
      if (!obj.length) out[prefix] = '[]';
      obj.forEach((v, i) => flatten(v, `${prefix}[${i}]`, out));
      return out;
    }
    const ks = Object.keys(obj);
    if (!ks.length) out[prefix] = '{}';
    for (const k of ks) flatten(obj[k], prefix ? `${prefix}.${k}` : k, out);
    return out;
  };

  /* ===== 3. 규칙 엔진 ===================================================== */

  const seriesOf = (productCode, override = null) => {
    if (override) {
      const s = RULES.series.find(x => x.id === override);
      if (!s) throw new Error(`[rules] 알 수 없는 계열 "${override}". 가능: ${RULES.series.map(x => x.id).join(', ')}`);
      return s;
    }
    if (!productCode) throw new Error('[rules] product_code 가 없어 계열을 판정할 수 없습니다. series 를 명시하세요.');
    const hit = RULES.series.find(s => s.test.test(productCode));
    if (!hit) throw new Error(
      `[rules] product_code "${productCode}" 의 계열을 판정할 수 없습니다.\n` +
      `        소비기한(12/18개월)과 HS CODE 가 갈리는 값이라 추측하지 않습니다.\n` +
      `        RULES.series 에 패턴을 추가하거나 { series:'white'|'darkmilk' } 로 명시하세요.`);
    return hit;
  };

  /** 소비기한 = 제조일 + N개월 - 1일  (MD 4-1 예시로 검증: 2026-11-23 +18m → 2028-05-22) */
  const bestByFrom = (mfgYmd, months) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(mfgYmd);
    if (!m) throw new Error(`[rules] 제조일 형식 오류: "${mfgYmd}" — YYYY-MM-DD 가 필요합니다.`);
    const y = +m[1], mo = +m[2], d = +m[3];
    const idx = (mo - 1) + months;
    const ty = y + Math.floor(idx / 12);
    const tm = ((idx % 12) + 12) % 12;
    const lastDay = new Date(Date.UTC(ty, tm + 1, 0)).getUTCDate();
    const cd = Math.min(d, lastDay);
    const dt = new Date(Date.UTC(ty, tm, cd));
    dt.setUTCDate(dt.getUTCDate() - 1);
    return { date: iso(dt), clamped: cd !== d, clampNote: cd !== d ? `${ty}-${String(tm + 1).padStart(2, '0')} 에 ${d}일이 없어 ${cd}일로 보정` : null };
  };

  const isCartonEligible = (productCode) =>
    !!productCode && RULES.cartonEligible.some(re => re.test(productCode));

  /* ===== 4. 읽기 API ====================================================== */

  const listFolders = () => req('label_folders?select=*&order=name.asc');

  const findFolder = async (name, parentId = FOLDER_CHOCO_ORDER) => {
    const q = `label_folders?select=*&name=eq.${encodeURIComponent(name)}` +
              (parentId ? `&parent_id=eq.${parentId}` : '');
    return (await req(q))[0] || null;
  };

  const listLabels = (folderId, select = '*') =>
    req(`saved_labels?folder_id=eq.${folderId}&select=${select}&order=${CARD_ORDER}`);

  const getLabel = async (id) => (await req(`saved_labels?id=eq.${id}&select=*`))[0] || null;

  const maxPosition = async (folderId) => {
    const rows = await req(`saved_labels?folder_id=eq.${folderId}&select=position&order=position.desc&limit=1`);
    return rows.length && rows[0].position != null ? rows[0].position : -1;
  };

  /* ===== 5. 스키마 발견 도구 ============================================== */

  /** 라벨의 form_data 전체 경로를 표로 출력. 신규제품 오버라이드 경로를 여기서 읽는다. */
  const dumpSchema = (label, { filter = null } = {}) => {
    const fd = label.form_data ?? label;
    const flat = flatten(fd);
    const rows = Object.entries(flat)
      .filter(([p]) => !filter || (filter instanceof RegExp ? filter.test(p) : p.includes(filter)))
      .map(([path, value]) => ({ path, value: typeof value === 'string' && value.length > 70 ? value.slice(0, 70) + '…' : value }));
    console.table(rows);
    return flat;
  };

  /** 값으로 경로를 역추적. 예: findPath(lbl, '1806.20') → HS CODE 필드 경로 */
  const findPath = (label, needle) => {
    const flat = flatten(label.form_data ?? label);
    const test = needle instanceof RegExp ? (v) => needle.test(String(v)) : (v) => String(v).includes(needle);
    const hits = Object.entries(flat).filter(([, v]) => v != null && test(v))
      .map(([path, value]) => ({ path, value }));
    console.table(hits);
    return hits;
  };

  /** 템플릿 라벨에서 netWeight / hsCode 경로를 자동 추정하고 PATHS 에 채운다. */
  const discoverPaths = (label) => {
    const found = {};
    const hs = findPath(label, /\b1806\.20|1704\.90\b/);
    if (hs.length === 1) found.hsCode = hs[0].path;
    const nw = findPath(label, /\d[\d,]*\s*g(\s*[x×]\s*\d+)?$/);
    if (nw.length === 1) found.netWeight = nw[0].path;

    Object.assign(PATHS, found);
    console.log('[core] PATHS =', { ...PATHS });
    for (const k of ['netWeight', 'hsCode']) {
      if (!PATHS[k]) console.warn(`[core] PATHS.${k} 미발견 — 후보가 0개 또는 2개 이상입니다. ` +
        `LE.dumpSchema(label) 로 직접 확인해 LE.PATHS.${k} = '<경로>' 로 지정하세요.`);
    }
    return { ...PATHS };
  };

  /* ===== 6. 계획 수립 (쓰기 없음) ========================================= */

  const buildRow = ({ name, productCode, formData, folderId, position }) => {
    const { UID, EMAIL } = auth();
    return {
      name, product_code: productCode, form_data: formData,
      folder_id: folderId, position,
      user_id: UID,
      creator_email: EMAIL, modifier_email: EMAIL,
    };
  };

  /**
   * 기존 차수 복제 (MD 5-3). 원재료·영양성분·바코드·알레르기를 보존하고 날짜만 교체.
   * @param {{srcFolderId:string, dstFolderId:string, mfgDate:string,
   *          only?:(l)=>boolean, startPosition?:number}} o
   */
  const planClone = async (o) => {
    const { srcFolderId, dstFolderId, mfgDate, only = null } = o;
    if (!srcFolderId || !dstFolderId) throw new Error('[plan] srcFolderId / dstFolderId 필요');
    const src = (await listLabels(srcFolderId)).filter(l => (only ? only(l) : true));
    if (!src.length) throw new Error('[plan] 원본 폴더에 라벨이 없습니다.');

    const start = o.startPosition ?? (await maxPosition(dstFolderId)) + 1;
    return src.map((s, i) => {
      const series = seriesOf(s.product_code);
      const bb = bestByFrom(mfgDate, series.shelfLifeMonths);
      const fd = deep(s.form_data);
      const prevMfg = setPath(fd, PATHS.mfgDate, mfgDate);
      const prevBB  = setPath(fd, PATHS.bestBy,  bb.date);
      return {
        action: 'clone', srcId: s.id,
        name: s.name, productCode: s.product_code,
        series: series.id, shelfLifeMonths: series.shelfLifeMonths,
        mfgDate, bestByDate: bb.date, clampNote: bb.clampNote,
        changes: [`${PATHS.mfgDate}: ${prevMfg} → ${mfgDate}`, `${PATHS.bestBy}: ${prevBB} → ${bb.date}`],
        row: buildRow({ name: s.name, productCode: s.product_code, formData: fd, folderId: dstFolderId, position: start + i }),
      };
    });
  };

  /**
   * 신규제품 (복제할 원본이 없을 때). 가장 가까운 기존 라벨을 템플릿으로 쓰고
   * 달라지는 필드만 경로 단위로 덮어쓴다. 경로 오타는 throw.
   * @param {{dstFolderId:string, mfgDate:string, items:Array<{
   *          templateLabelId:string, name:string, productCode:string,
   *          series?:'white'|'darkmilk', overrides:Object<string,any>, sizeTag?:string }>}} o
   */
  const planNew = async (o) => {
    const { dstFolderId, mfgDate, items } = o;
    if (!dstFolderId || !mfgDate || !items?.length) throw new Error('[plan] dstFolderId / mfgDate / items 필요');
    const start = o.startPosition ?? (await maxPosition(dstFolderId)) + 1;
    const cache = new Map();
    const out = [];

    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (!it.templateLabelId) throw new Error(`[plan] items[${i}] templateLabelId 필요 — 스키마를 추측하지 않습니다.`);
      if (!it.overrides || !Object.keys(it.overrides).length)
        throw new Error(`[plan] items[${i}] ("${it.name}") overrides 가 비어 있습니다. 템플릿 내용이 그대로 복사되어 잘못된 표시사항이 나갑니다.`);

      if (!cache.has(it.templateLabelId)) cache.set(it.templateLabelId, await getLabel(it.templateLabelId));
      const tpl = cache.get(it.templateLabelId);
      if (!tpl) throw new Error(`[plan] 템플릿 라벨 없음: ${it.templateLabelId}`);

      const series = seriesOf(it.productCode, it.series);
      const bb = bestByFrom(mfgDate, series.shelfLifeMonths);
      const fd = deep(tpl.form_data);
      const changes = [];

      for (const [p, v] of Object.entries(it.overrides)) {
        const before = setPath(fd, p, v);
        changes.push(`${p}: ${JSON.stringify(before)} → ${JSON.stringify(v)}`);
      }
      // HS CODE 는 계열이 정하는 값. 경로를 알면 자동 보정하고, 모르면 경고만.
      if (PATHS.hsCode && !(PATHS.hsCode in it.overrides)) {
        const before = setPath(fd, PATHS.hsCode, series.hsCode);
        if (before !== series.hsCode) changes.push(`${PATHS.hsCode}: ${before} → ${series.hsCode} (계열 규칙)`);
      } else if (!PATHS.hsCode) {
        console.warn(`[plan] "${it.name}": PATHS.hsCode 미설정 — HS CODE 가 템플릿 값(${series.id === 'white' ? '화이트가 아니면 틀림' : '화이트면 틀림'})으로 남습니다. 직접 확인하세요.`);
      }
      setPath(fd, PATHS.mfgDate, mfgDate);
      setPath(fd, PATHS.bestBy,  bb.date);
      changes.push(`${PATHS.mfgDate} → ${mfgDate}`, `${PATHS.bestBy} → ${bb.date}`);

      out.push({
        action: 'new', templateLabelId: it.templateLabelId,
        name: it.name, productCode: it.productCode, sizeTag: it.sizeTag ?? null,
        series: series.id, shelfLifeMonths: series.shelfLifeMonths,
        mfgDate, bestByDate: bb.date, clampNote: bb.clampNote,
        cartonEligible: isCartonEligible(it.productCode),
        changes,
        row: buildRow({ name: it.name, productCode: it.productCode, formData: fd, folderId: dstFolderId, position: start + i }),
      });
    }
    return out;
  };

  /* ===== 7. 계획 검토 / 실행 ============================================== */

  const review = async (plan) => {
    console.table(plan.map((p, i) => ({
      '#': i + 1, action: p.action, name: p.name, product_code: p.productCode,
      계열: p.series, 소비기한개월: p.shelfLifeMonths,
      제조일: p.mfgDate, 소비기한: p.bestByDate,
      카톤대상: p.cartonEligible ?? '', position: p.row.position,
    })));
    plan.forEach((p, i) => { if (p.clampNote) console.warn(`[review] #${i + 1} ${p.name}: ${p.clampNote}`); });

    // 같은 폴더 내 중복 이름 사전 점검
    const folderId = plan[0].row.folder_id;
    const exist = new Set((await listLabels(folderId, 'name')).map(r => r.name));
    const dupExist = plan.filter(p => exist.has(p.name)).map(p => p.name);
    const seen = new Set(), dupSelf = [];
    plan.forEach(p => { if (seen.has(p.name)) dupSelf.push(p.name); seen.add(p.name); });

    if (dupExist.length) console.warn('[review] 대상 폴더에 같은 이름이 이미 있음:', dupExist);
    if (dupSelf.length)  console.warn('[review] 계획 안에서 이름 중복 (PDF 파일명이 충돌합니다):', dupSelf);

    console.log(`[review] 총 ${plan.length}건. 이상 없으면: await LE.apply(plan, { confirm:'CREATE' })`);
    return { count: plan.length, dupExist, dupSelf };
  };

  /** 실제 POST. confirm:'CREATE' 없으면 아무것도 쓰지 않는다. */
  const apply = async (plan, { confirm } = {}) => {
    if (confirm !== 'CREATE')
      throw new Error("[apply] 쓰기 보호. 계획을 확인한 뒤 LE.apply(plan, { confirm:'CREATE' }) 로 호출하세요.");
    await review(plan);

    const results = [];
    for (let i = 0; i < plan.length; i++) {
      const p = plan[i];
      try {
        const [row] = await req('saved_labels', { method: 'POST', headers: writeHeaders, body: JSON.stringify(p.row) });
        results.push({ ok: true, seq: i + 1, id: row.id, name: p.name, productCode: p.productCode, plan: p });
        console.log(`[apply] ${i + 1}/${plan.length} OK  ${p.name}  (${row.id})`);
      } catch (e) {
        results.push({ ok: false, seq: i + 1, name: p.name, error: e.message, plan: p });
        console.error(`[apply] ${i + 1}/${plan.length} 실패  ${p.name}\n${e.message}`);
      }
    }
    const bad = results.filter(r => !r.ok);
    console.log(`[apply] 완료 — 성공 ${results.length - bad.length} / 실패 ${bad.length}`);
    if (bad.length) console.warn('[apply] 실패분은 수정 후 해당 항목만 다시 apply 하세요.');
    return results;
  };

  /** POST 후 되읽어 날짜가 의도대로 들어갔는지 전수 확인 */
  const verify = async (results) => {
    const rows = [];
    for (const r of results.filter(x => x.ok)) {
      const l = await getLabel(r.id);
      const mfg = getPath(l.form_data, PATHS.mfgDate);
      const bb  = getPath(l.form_data, PATHS.bestBy);
      const okM = mfg === r.plan.mfgDate, okB = bb === r.plan.bestByDate;
      rows.push({ '#': r.seq, name: r.name, 제조일: mfg, 소비기한: bb, 판정: okM && okB ? 'OK' : '불일치' });
      if (!(okM && okB)) console.error(`[verify] 불일치 ${r.name}: 기대 ${r.plan.mfgDate}/${r.plan.bestByDate} → 실제 ${mfg}/${bb}`);
    }
    console.table(rows);
    const ng = rows.filter(r => r.판정 !== 'OK').length;
    console.log(ng ? `[verify] 불일치 ${ng}건 — 수정 필요` : '[verify] 전수 통과');
    return rows;
  };

  /* ===== 8. 폴더 ========================================================== */

  const createFolder = async (name, parentId = FOLDER_CHOCO_ORDER) => {
    const dup = await findFolder(name, parentId);
    if (dup) { console.warn(`[folder] "${name}" 이 이미 있습니다 — 기존 폴더를 씁니다. (${dup.id})`); return dup; }
    const { UID } = auth();
    const [row] = await req('label_folders', { method: 'POST', headers: writeHeaders, body: JSON.stringify({ name, parent_id: parentId, user_id: UID }) });
    console.log(`[folder] 생성 "${name}" → ${row.id}`);
    return row;
  };

  /* ===== 9. manifest — PDF 리네임의 단일 기준 (사고 7-2 방지) ============== */

  /**
   * 카드 클릭 순서대로 "다운로드될 파일명"과 "최종 파일명"을 확정해 JSON 으로 내린다.
   * index 매핑을 쓰지 않으므로 Downloads 에 남은 동명 파일에 밀리지 않는다.
   */
  const manifest = async (folderId, { mfgDate = null, sizeTagOf = null, download = true } = {}) => {
    const labels = await listLabels(folderId);                 // 카드 순서 = 클릭/다운로드 순서
    const folder = (await req(`label_folders?id=eq.${folderId}&select=*`))[0];
    const seenName = new Map();

    const clickOrder = labels.map((l, i) => {
      const n = seenName.get(l.name) ?? 0;
      seenName.set(l.name, n + 1);
      const sizeTag = sizeTagOf ? sizeTagOf(l) : (/_(\d+(?:kg|g)[^_]*)$/i.exec(l.name)?.[1] ?? null);
      return {
        seq: i + 1, labelId: l.id, name: l.name, productCode: l.product_code,
        position: l.position,
        mfgDate:    getPath(l.form_data, PATHS.mfgDate),
        bestByDate: getPath(l.form_data, PATHS.bestBy),
        netWeight:  PATHS.netWeight ? getPath(l.form_data, PATHS.netWeight) : null,
        sizeTag,
        // Chrome 은 동명 파일에 " (1)", " (2)" … 를 붙인다 (첫 파일은 접미사 없음)
        downloadName: n === 0 ? `${l.name}.pdf` : `${l.name} (${n}).pdf`,
        targetName:   sizeTag ? `${l.name}_${sizeTag}.pdf` : `${l.name}.pdf`,
      };
    });

    const dupTarget = clickOrder.map(c => c.targetName)
      .filter((v, i, a) => a.indexOf(v) !== i);
    if (dupTarget.length) console.error('[manifest] 최종 파일명 중복 — sizeTag 를 지정하세요:', [...new Set(dupTarget)]);

    const man = {
      generatedAt: new Date().toISOString(),
      folder: { id: folderId, name: folder?.name ?? null },
      mfgDate: mfgDate ?? clickOrder[0]?.mfgDate ?? null,
      expectedCount: clickOrder.length,
      clickOrder,
    };
    console.table(clickOrder.map(c => ({ seq: c.seq, name: c.name, sizeTag: c.sizeTag, download: c.downloadName, target: c.targetName })));

    if (download) {
      const blob = new Blob([JSON.stringify(man, null, 2)], { type: 'application/json' });
      const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: 'manifest.json' });
      document.body.appendChild(a); a.click(); a.remove();
      console.log('[manifest] manifest.json 다운로드 완료 — 스테이징 폴더로 옮기세요.');
    }
    return man;
  };

  /* ===== 공개 API ========================================================= */

  window.LE = {
    FOLDER_CHOCO_ORDER, RULES, PATHS, CARD_ORDER,
    // 읽기
    listFolders, findFolder, listLabels, getLabel, maxPosition,
    // 스키마 발견
    dumpSchema, findPath, discoverPaths, getPath, setPath, flatten,
    // 규칙
    seriesOf, bestByFrom, isCartonEligible,
    // 계획·실행
    planClone, planNew, review, apply, verify, createFolder,
    // 산출물
    manifest,
    // 저수준
    req, today,
  };

  console.log('%c[core] LE 준비 완료', 'color:#06c;font-weight:bold',
    '\n  03_run_clone.js (기존 차수 복제) 또는 04_run_new.js (신규제품) 로 진행하세요.' +
    '\n  규칙 확인: LE.RULES / LE.PATHS');
})();


/* ===== 3부 — 나폴리탄 14종 데이터 ======================================== */
/* 자동 생성 — 나폴리탄 14종 라벨 데이터 (규격서 2026-11-12 기준) */
window.NAPOLITAN = [
 {
  "flavor": "화이트 블루베리",
  "sample": "2-21",
  "series": "화이트",
  "shelfLifeMonths": 12,
  "hsCode": "1704.90-9000",
  "ingredients": "코코아버터 38%, 전지분유 36%, 설탕 20.14%, 동결건조블루베리분말 5%, 레시틴(유화제) 0.38%, PGPR(유화제) 0.28%, 천연향료(바닐라) 0.1%, 합성향료 0.1%",
  "allergens": "대두, 우유 함유",
  "nutrition": {
   "열량": "619kcal",
   "탄수화물": "43g",
   "당류": "39g",
   "지방": "47g",
   "트랜스지방": "0g",
   "포화지방": "29g",
   "콜레스테롤": "16mg",
   "단백질": "6g",
   "나트륨": "75mg"
  },
  "composition": "White 40%(94.95%+FD블루베리분 5%)+인공블루베리향0.1%"
 },
 {
  "flavor": "밀크 38%",
  "sample": "1-7",
  "series": "밀크",
  "shelfLifeMonths": 18,
  "hsCode": "1806.20-1000",
  "ingredients": "설탕 31.4%, 전지분유 30%, 코코아매스 25.5%, 코코아버터 12.5%, 레시틴(유화제) 0.3%, PGPR(유화제) 0.2%, 천연향료(바닐라) 0.1%",
  "allergens": "대두, 우유 함유",
  "nutrition": {
   "열량": "566kcal",
   "탄수화물": "48g",
   "당류": "40g",
   "지방": "38g",
   "트랜스지방": "0g",
   "포화지방": "23g",
   "콜레스테롤": "16mg",
   "단백질": "8g",
   "나트륨": "78mg"
  },
  "composition": "Milk 38%(100%)"
 },
 {
  "flavor": "다크 마카다미아",
  "sample": "1-8",
  "series": "다크",
  "shelfLifeMonths": 18,
  "hsCode": "1806.20-1000",
  "ingredients": "코코아매스 33.12%, 설탕 28%, 코코아버터 16.2%, 볶은마카다미아 15%, 전지분유 7.14%, 레시틴(유화제) 0.34%, PGPR(유화제) 0.1%, 천연향료(바닐라) 0.1%",
  "allergens": "대두, 마카다미아, 우유 함유",
  "nutrition": {
   "열량": "598kcal",
   "탄수화물": "40g",
   "당류": "32g",
   "지방": "46g",
   "트랜스지방": "0g",
   "포화지방": "23g",
   "콜레스테롤": "3mg",
   "단백질": "6g",
   "나트륨": "19mg"
  },
  "composition": "Dark 58%(85%)+마카다미아(15%)"
 },
 {
  "flavor": "화이트 스트로베리",
  "sample": "2-22",
  "series": "화이트",
  "shelfLifeMonths": 12,
  "hsCode": "1704.90-9000",
  "ingredients": "코코아버터 38%, 전지분유 36%, 설탕 20.24%, 동결건조딸기 5%, 레시틴(유화제) 0.38%, PGPR(유화제) 0.28%, 천연향료(바닐라) 0.1%",
  "allergens": "대두, 우유 함유",
  "nutrition": {
   "열량": "619kcal",
   "탄수화물": "43g",
   "당류": "39g",
   "지방": "47g",
   "트랜스지방": "0g",
   "포화지방": "29g",
   "콜레스테롤": "16mg",
   "단백질": "6g",
   "나트륨": "75mg"
  },
  "composition": "White 40%(95%+FD딸기5%)"
 },
 {
  "flavor": "화이트 요거트",
  "sample": "3-3",
  "series": "화이트",
  "shelfLifeMonths": 12,
  "hsCode": "1704.90-9000",
  "ingredients": "코코아버터 34.8%, 전지분유 33%, 설탕 18.5%, 동결건조요거트분말 13%, 레시틴(유화제) 0.35%, PGPR(유화제) 0.26%, 천연향료(바닐라) 0.09%",
  "allergens": "대두, 우유 함유",
  "nutrition": {
   "열량": "558kcal",
   "탄수화물": "39g",
   "당류": "35g",
   "지방": "42g",
   "트랜스지방": "g",
   "포화지방": "26g",
   "콜레스테롤": "14mg",
   "단백질": "6g",
   "나트륨": "68mg"
  },
  "composition": "White 40%(87%+요큐브13%)"
 },
 {
  "flavor": "화이트 말차",
  "sample": "3-7",
  "series": "화이트",
  "shelfLifeMonths": 12,
  "hsCode": "1704.90-9000",
  "ingredients": "코코아버터 38.8%, 전지분유 36.86%, 설탕 20.6%, 녹차분말 3%, 레시틴(유화제) 0.39%, PGPR(유화제) 0.25%, 천연향료(바닐라) 0.1%",
  "allergens": "대두, 우유 함유",
  "nutrition": {
   "열량": "597kcal",
   "탄수화물": "42g",
   "당류": "38g",
   "지방": "45g",
   "트랜스지방": "g",
   "포화지방": "28g",
   "콜레스테롤": "15mg",
   "단백질": "6g",
   "나트륨": "73mg"
  },
  "composition": "White 40%(97%+말차3%)"
 },
 {
  "flavor": "다크 크런치 오렌지",
  "sample": "1-9",
  "series": "다크",
  "shelfLifeMonths": 18,
  "hsCode": "1806.20-1000",
  "ingredients": "코코아매스 31.2%, 설탕 26.16%, 코코아버터 15.2%, 건조오렌지껍질 10%, 콘플레이크 10%, 전지분유 6.72%, 레시틴(유화제) 0.32%, PGPR(유화제) 0.32%, 천연향료(바닐라) 0.08%",
  "allergens": "대두, 밀, 우유 함유",
  "nutrition": {
   "열량": "529kcal",
   "탄수화물": "43g",
   "당류": "36g",
   "지방": "37g",
   "트랜스지방": "0g",
   "포화지방": "23g",
   "콜레스테롤": "4mg",
   "단백질": "6g",
   "나트륨": "20mg"
  },
  "composition": "Dark 58%(80%)+건오렌지껍질(10%)+콘푸레이크(10%)"
 },
 {
  "flavor": "다크 씨솔트",
  "sample": "2-2",
  "series": "다크",
  "shelfLifeMonths": 18,
  "hsCode": "1806.20-1000",
  "ingredients": "코코아매스 38.9%, 설탕 32.5%, 코코아버터 19%, 전지분유 8.4%, 레시틴(유화제) 0.4%, PGPR(유화제) 0.4%, 천일염 0.3%, 천연향료(바닐라) 0.1%",
  "allergens": "대두, 우유 함유",
  "nutrition": {
   "열량": "529kcal",
   "탄수화물": "43g",
   "당류": "36g",
   "지방": "37g",
   "트랜스지방": "0g",
   "포화지방": "23g",
   "콜레스테롤": "4mg",
   "단백질": "6g",
   "나트륨": "140mg"
  },
  "composition": "Dark 58%(99.7%+씨솔트0.3%)"
 },
 {
  "flavor": "다크 페퍼 솔트",
  "sample": "2-4",
  "series": "다크",
  "shelfLifeMonths": 18,
  "hsCode": "1806.20-1000",
  "ingredients": "코코아매스 38.4%, 설탕 32.2%, 코코아버터 19%, 전지분유 8.3%, 레몬분말 0.8%, 레시틴(유화제) 0.4%, PGPR(유화제) 0.4%, 흑후추 0.2%, 천일염 0.2%, 천연향료(바닐라) 0.1%",
  "allergens": "대두, 우유 함유",
  "nutrition": {
   "열량": "529kcal",
   "탄수화물": "43g",
   "당류": "36g",
   "지방": "37g",
   "트랜스지방": "0g",
   "포화지방": "23g",
   "콜레스테롤": "4mg",
   "단백질": "6g",
   "나트륨": "140mg"
  },
  "composition": "Dark 58%(98.8%+레몬분0.8+흑후추0.2%+씨솔트0.2%)"
 },
 {
  "flavor": "다크 카카오닙스",
  "sample": "3-4",
  "series": "다크",
  "shelfLifeMonths": 18,
  "hsCode": "1806.20-1000",
  "ingredients": "코코아매스 35.1%, 설탕 29.5%, 코코아버터 17%, 카카오닙스 10%, 전지분유 7.56%, 레시틴(유화제) 0.37%, PGPR(유화제) 0.37%, 천연향료(바닐라) 0.1%",
  "allergens": "대두, 우유 함유",
  "nutrition": {
   "열량": "578kcal",
   "탄수화물": "43g",
   "당류": "33g",
   "지방": "42g",
   "트랜스지방": "0g",
   "포화지방": "23g",
   "콜레스테롤": "3mg",
   "단백질": "7g",
   "나트륨": "20mg"
  },
  "composition": "Dark 58%(90%+Cacao nips10%)"
 },
 {
  "flavor": "다크 크런치",
  "sample": "3-11",
  "series": "다크",
  "shelfLifeMonths": 18,
  "hsCode": "1806.20-1000",
  "ingredients": "코코아매스 33.15%, 설탕 27.77%, 코코아버터 16.1%, 콘플레이크 15%, 전지분유 7.13%, PGPR(유화제) 0.43%, 레시틴(유화제) 0.34%, 천연향료(바닐라) 0.085%",
  "allergens": "대두, 밀, 우유 함유",
  "nutrition": {
   "열량": "547kcal",
   "탄수화물": "51g",
   "당류": "32g",
   "지방": "35g",
   "트랜스지방": "0g",
   "포화지방": "23g",
   "콜레스테롤": "3mg",
   "단백질": "7g",
   "나트륨": "82mg"
  },
  "composition": "Dark 58%(85%+콘프레이크15%)"
 },
 {
  "flavor": "밀크 피넛",
  "sample": "2-13",
  "series": "밀크",
  "shelfLifeMonths": 18,
  "hsCode": "1806.20-1000",
  "ingredients": "코코아버터 32.27%, 전지분유 21.32%, 설탕 18.94%, 볶은땅콩 15%, 코코아매스 11.85%, 레시틴(유화제) 0.3111%, PGPR(유화제) 0.2261%, 천연향료(바닐라) 0.085%",
  "allergens": "대두, 땅콩, 우유 함유",
  "nutrition": {
   "열량": "627.5kcal",
   "탄수화물": "40.96g",
   "당류": "33.56g",
   "지방": "48.7g",
   "트랜스지방": "g",
   "포화지방": "30.02g",
   "콜레스테롤": "10.9mg",
   "단백질": "6.34g",
   "나트륨": "46mg"
  },
  "composition": "Milk52%(85%+땅콩15%)"
 },
 {
  "flavor": "밀크 아몬드",
  "sample": "3-6",
  "series": "밀크",
  "shelfLifeMonths": 18,
  "hsCode": "1806.20-1000",
  "ingredients": "코코아버터 32.27%, 전지분유 21.32%, 설탕 18.94%, 볶은아몬드 15%, 코코아매스 11.85%, 레시틴(유화제) 0.3111%, PGPR(유화제) 0.2261%, 천연향료(바닐라) 0.085%",
  "allergens": "대두, 아몬드, 우유 함유",
  "nutrition": {
   "열량": "627.5kcal",
   "탄수화물": "40.96g",
   "당류": "33.56g",
   "지방": "48.7g",
   "트랜스지방": "g",
   "포화지방": "30.02g",
   "콜레스테롤": "10.9mg",
   "단백질": "6.34g",
   "나트륨": "46mg"
  },
  "composition": "Milk52%(85%+아몬드15%)"
 },
 {
  "flavor": "밀크 솔티드 카라멜",
  "sample": "3-10",
  "series": "밀크",
  "shelfLifeMonths": 18,
  "hsCode": "1806.20-1000",
  "ingredients": "코코아버터 38.2%, 설탕 26.88%, 전지분유 21%, 코코아매스 12.8%, 천일염 0.5%, 레시틴(유화제) 0.31%, PGPR(유화제) 0.22%, 천연향료(바닐라) 0.09%",
  "allergens": "대두, 우유 함유",
  "nutrition": {
   "열량": "597kcal",
   "탄수화물": "46g",
   "당류": "36g",
   "지방": "46g",
   "트랜스지방": "g",
   "포화지방": "28g",
   "콜레스테롤": "10mg",
   "단백질": "6g",
   "나트륨": "243mg"
  },
  "composition": "Milk 52%(94.5%+Caramel5%+씨솔트 0.5%)"
 }
];


/* ===========================================================================
 * 4부 — 쉬운 사용 창구
 * ========================================================================= */
const say = (m, c='') => console.log(`%c${m}`, c || 'font-size:13px');
const big = (m) => console.log(`%c${m}`, 'font-size:15px;font-weight:bold;color:#c45500');

const 찾기 = {
  수입원주소: [/수원|용인|기흥|영통|삼성로|흥덕/],
  수입원명  : [/오투인터내셔널/],
  제조원    : [/PAVE|Ho Chi Minh|베트남|Vietnam|호치민/i],
  원재료명  : [/코코아|설탕|전지분유|카카오/],
  알레르기  : [/함유/],
  HS코드    : [/1806\.20|1704\.90/],
  내용량    : [/^\s*[\d,]+\s*g(\s*[x×]\s*\d+)?\s*$/],
};

const 경로찾기 = (label) => {
  const flat = LE.flatten(label.form_data);
  const hit = {};
  for (const [항목, pats] of Object.entries(찾기)) {
    const found = Object.entries(flat).filter(([, v]) =>
      v != null && typeof v !== 'object' && pats.some(p => p.test(String(v))));
    hit[항목] = found.map(([p, v]) => ({ 경로: p, 현재값: String(v).slice(0, 60) }));
  }
  // 영양성분: 숫자+단위가 모여 있는 블록
  hit.영양성분 = Object.entries(flat)
    .filter(([p, v]) => /nutrition/i.test(p) && v != null && String(v).trim() !== '')
    .map(([p, v]) => ({ 경로: p, 현재값: String(v).slice(0, 40) }));
  return hit;
};

let 상태 = { 템플릿: null, 경로: null, 설정값: null };

window.확인 = async () => {
  big('\n[1] 라벨에디터에서 기존 라벨을 찾는 중...');
  const folders = await LE.listFolders();
  const all = [];
  for (const f of folders) {
    const ls = await LE.listLabels(f.id, 'id,name,product_code,folder_id');
    ls.forEach(l => all.push({ ...l, 폴더: f.name }));
  }
  say(`   폴더 ${folders.length}개 / 라벨 ${all.length}개를 찾았습니다.`);
  if (!all.length) { say('   라벨이 하나도 없습니다. 기존 라벨이 있어야 베껴올 수 있습니다.', 'color:#b00'); return; }

  big('\n[2] 베껴올 라벨(템플릿) 고르기');
  console.table(all.map((l, i) => ({ 번호: i + 1, 폴더: l.폴더, 라벨이름: l.name, 제품코드: l.product_code })));
  window.__all = all;
  say('\n   위 표에서 "파베글라스가 만든 제품" 중 내용이 가장 비슷한 것의 번호를 골라');
  big('   고르기(번호)   ← 예: 고르기(3)');
};

window.고르기 = async (번호) => {
  const l = window.__all?.[번호 - 1];
  if (!l) throw new Error('번호가 잘못되었습니다. 확인() 을 다시 실행하세요.');
  const full = await LE.getLabel(l.id);
  상태.템플릿 = full;
  상태.경로 = 경로찾기(full);

  big(`\n[3] "${full.name}" 안에서 항목 위치를 찾았습니다`);
  for (const [항목, 목록] of Object.entries(상태.경로)) {
    if (!목록.length) { say(`   ✗ ${항목}  — 못 찾음`, 'color:#b00'); continue; }
    say(`   ✓ ${항목}`, 'color:#070');
    console.table(목록);
  }
  say('\n   ※ 제조원은 "그대로 두기"로 하셨으니 건드리지 않습니다.');
  big('\n[4] 라벨에 넣을 값을 알려주세요');
  say('   아래 한 줄을 고쳐서 실행하세요. 모르는 값은 빈칸("")으로 두셔도 됩니다.\n');
  big(`   설정({ 내용량:"", 제조일:"", 제품코드앞글자:"", 폴더이름:"나폴리탄" })`);
  say('\n   예)  설정({ 내용량:"500g", 제조일:"2027-01-15", 제품코드앞글자:"PG-NAP", 폴더이름:"나폴리탄" })');
};

window.설정 = (v = {}) => {
  상태.설정값 = {
    내용량: v.내용량 || '', 제조일: v.제조일 || '',
    제품코드앞글자: v.제품코드앞글자 || '', 폴더이름: v.폴더이름 || '나폴리탄',
  };
  const s = 상태.설정값;
  big('\n[5] 이렇게 만들겠습니다');
  say(`   폴더      : ${s.폴더이름}`);
  say(`   내용량    : ${s.내용량 || '(비움 — 나중에 화면에서 채우세요)'}`);
  say(`   제조일    : ${s.제조일 || '(비움 — 소비기한도 비워둡니다)'}`);
  say(`   제품코드  : ${s.제품코드앞글자 ? s.제품코드앞글자 + '-01 ~ -14' : '(비움)'}`);
  console.table(NAPOLITAN.map((p, i) => ({
    번호: i + 1, 라벨이름: p.flavor, 계열: p.series,
    소비기한: s.제조일 ? LE.bestByFrom(s.제조일, p.shelfLifeMonths).date : '(비움)',
    원재료: p.ingredients.slice(0, 40) + '…', 알레르기: p.allergens,
  })));
  big('\n   맞으면 →  만들기()');
};

window.만들기 = async () => {
  if (!상태.템플릿 || !상태.설정값) throw new Error('확인() → 고르기(번호) → 설정({...}) 을 먼저 하세요.');
  const s = 상태.설정값, 경로 = 상태.경로;
  const one = (항목) => 경로[항목]?.length === 1 ? 경로[항목][0].경로 : null;

  const p원재료 = one('원재료명'), p알레르기 = one('알레르기');
  if (!p원재료 || !p알레르기) {
    say('원재료명 또는 알레르기 위치를 하나로 특정하지 못했습니다. 위 표를 저에게 보여주세요.', 'color:#b00');
    throw new Error('중단 — 잘못된 칸에 쓰면 라벨이 틀어집니다.');
  }
  const p수입원주소 = one('수입원주소'), p수입원명 = one('수입원명');
  const pHS = one('HS코드'), p내용량 = one('내용량');

  const dst = await LE.createFolder(s.폴더이름, null);
  const start = (await LE.maxPosition(dst.id)) + 1;
  const 결과 = [];

  for (let i = 0; i < NAPOLITAN.length; i++) {
    const p = NAPOLITAN[i];
    const fd = JSON.parse(JSON.stringify(상태.템플릿.form_data));
    LE.setPath(fd, p원재료, p.ingredients);
    LE.setPath(fd, p알레르기, p.allergens);
    if (pHS) LE.setPath(fd, pHS, p.hsCode);
    if (p수입원명)   LE.setPath(fd, p수입원명, '(주)오투인터내셔널');
    if (p수입원주소) LE.setPath(fd, p수입원주소, '경기도 수원시 영통구 삼성로 274, 2층 제상가 207·208호(원천동, 수원팩토리월드)');
    if (p내용량)     LE.setPath(fd, p내용량, s.내용량);
    if (s.제조일) {
      LE.setPath(fd, LE.PATHS.mfgDate, s.제조일);
      LE.setPath(fd, LE.PATHS.bestBy, LE.bestByFrom(s.제조일, p.shelfLifeMonths).date);
    }
    const row = {
      name: p.flavor,
      product_code: s.제품코드앞글자 ? `${s.제품코드앞글자}-${String(i + 1).padStart(2, '0')}` : '',
      form_data: fd, folder_id: dst.id, position: start + i,
      user_id: LE_AUTH.UID, creator_email: LE_AUTH.EMAIL, modifier_email: LE_AUTH.EMAIL,
    };
    try {
      const [created] = await LE.req('saved_labels', {
        method: 'POST',
        headers: { 'content-type': 'application/json', prefer: 'return=representation' },
        body: JSON.stringify(row),
      });
      결과.push({ 번호: i + 1, 라벨: p.flavor, 결과: '성공' });
      say(`   ${i + 1}/14  ${p.flavor}  만들었습니다`, 'color:#070');
    } catch (e) {
      결과.push({ 번호: i + 1, 라벨: p.flavor, 결과: '실패: ' + e.message.slice(0, 60) });
      say(`   ${i + 1}/14  ${p.flavor}  실패 — ${e.message.slice(0, 80)}`, 'color:#b00');
    }
  }
  console.table(결과);
  const 실패 = 결과.filter(r => r.결과 !== '성공').length;
  big(`\n완료 — 성공 ${결과.length - 실패}개 / 실패 ${실패}개`);
  say(`라벨에디터 화면을 새로고침하면 "${s.폴더이름}" 폴더에 보입니다.`);
  if (!s.내용량 || !s.제조일) say('※ 비워둔 칸은 화면에서 직접 채우신 뒤 PDF를 뽑으세요.', 'color:#a60');
  window.__dst = dst;
  return 결과;
};

big('\n준비 끝났습니다. 아래를 그대로 입력하세요.');
big('확인()');

})().catch(e => console.error('%c오류: ' + e.message, 'color:#b00;font-size:14px'));
