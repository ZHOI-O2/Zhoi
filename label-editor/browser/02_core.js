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
