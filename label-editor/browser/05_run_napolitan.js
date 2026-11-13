/* ============================================================================
 * 05_run_napolitan.js — 나폴리탄 14종 라벨 생성
 * ----------------------------------------------------------------------------
 * 전제: 01_auth.js → 02_core.js → _napolitan_data.js → 이 파일 순서로 콘솔에 붙여넣기.
 *
 * 제조원 처리: 사용자가 "기존 라벨과 동일하게"로 확정했으므로, 기존 파베글라스
 * 라벨을 템플릿으로 복제해 제조원 필드를 건드리지 않는다. 덮어쓰는 것은
 * 제품별로 달라지는 값(원재료명·영양성분·알레르기)과 수입원 주소뿐이다.
 *
 * 진행:
 *   await NP.step1()                 템플릿 후보 + form_data 경로 확인
 *   NP.PATHS = {...}                 step1 출력을 보고 경로 지정
 *   NP.CONFIG = {...}                제품명/코드/내용량/제조일 입력
 *   await NP.step2()                 계획 수립 (쓰기 없음)
 *   await LE.apply(__plan,{confirm:'CREATE'}) ; await LE.verify(res)
 * ========================================================================== */
(() => {
  'use strict';
  if (!window.LE) throw new Error('02_core.js 를 먼저 실행하세요.');
  if (!window.NAPOLITAN) throw new Error('_napolitan_data.js 를 먼저 실행하세요.');

  /* ===== 확정값 ========================================================== */

  // 2026-11-04 갱신 사업자등록증(동수원세무서장) 기준 — 사용자 확정
  const 수입원_소재지 = '경기도 수원시 영통구 삼성로 274, 2층 제상가 207·208호(원천동, 수원팩토리월드)';
  const 수입원_상호   = '(주)오투인터내셔널';

  /* ===== 사용자가 채울 값 ================================================ */

  const CONFIG = {
    TEMPLATE_LABEL_ID: '',      // step1 에서 고른 기존 파베글라스 라벨 id (제조원 보존용)
    DST_FOLDER_NAME:   '나폴리탄',
    DST_PARENT_ID:     null,    // null = 최상위. 초콜릿발주 아래면 LE.FOLDER_CHOCO_ORDER
    MFG_DATE:          '',      // 'YYYY-MM-DD'. 비우면 날짜를 건드리지 않는다.
    // 제품별 값. 비워 두면 그 필드는 템플릿 값이 남으므로 반드시 채울 것.
    PER_ITEM: {
      // '화이트 블루베리': { productName:'', productCode:'', netWeight:'', barcode:'' },
    },
    DEFAULT: { netWeight: '', barcode: '' },   // 14종 공통이면 여기에
  };

  /* ===== form_data 경로 — step1 출력을 보고 채운다 ======================= */

  const PATHS = {
    productName: null,   // 예 'productInfo.productName'
    netWeight:   null,
    barcode:     null,
    ingredients: null,   // 원재료명
    allergens:   null,   // 알레르기 표시
    hsCode:      null,
    importer:    null,   // 수입원 상호
    importerAddr:null,   // 수입원 소재지  ← 이것만 바꾼다
    nutrition:   {},     // { 열량:'경로', 탄수화물:'경로', ... }
  };

  /* ===== STEP 1 — 템플릿 탐색 & 스키마 확인 ============================== */

  const step1 = async (folderName) => {
    console.log('%c[step1] 폴더 목록', 'font-weight:bold');
    const folders = await LE.listFolders();
    console.table(folders.map(f => ({ id: f.id, name: f.name, parent_id: f.parent_id })));

    if (!folderName) {
      console.log('파베글라스 제품이 들어 있는 폴더명을 넣어 다시 호출하세요:  await NP.step1("<폴더명>")');
      return { folders };
    }
    const f = folders.find(x => x.name === folderName);
    if (!f) throw new Error(`폴더 "${folderName}" 없음`);
    const labels = await LE.listLabels(f.id);
    console.log(`%c[step1] "${folderName}" 라벨 ${labels.length}건`, 'font-weight:bold');
    console.table(labels.map(l => ({ id: l.id, name: l.name, product_code: l.product_code })));

    const tpl = labels[0];
    if (tpl) {
      console.log(`%c[step1] 스키마 — 템플릿 "${tpl.name}"`, 'font-weight:bold');
      LE.dumpSchema(tpl);
      console.log('%c[step1] 값으로 경로 역추적', 'font-weight:bold');
      console.log('수입원/제조원 후보:');  LE.findPath(tpl, /오투|수원|용인|베트남|Vietnam|PAVE|Ho Chi Minh/i);
      console.log('원재료명 후보:');        LE.findPath(tpl, /코코아|설탕|전지분유/);
      console.log('알레르기 후보:');        LE.findPath(tpl, /함유|우유|대두/);
      console.log('HS CODE 후보:');        LE.findPath(tpl, /1806\.20|1704\.90/);
      console.log('영양성분 후보:');        LE.dumpSchema(tpl, { filter: /^nutrition/ });
      window.__tpl = tpl;
      console.log('\n위 경로를 보고 NP.PATHS 를 채운 뒤 NP.CONFIG 를 입력하고 await NP.step2() 를 호출하세요.');
    }
    return { folder: f, labels, template: tpl };
  };

  /* ===== STEP 2 — 계획 수립 ============================================== */

  const step2 = async () => {
    const miss = ['productName','ingredients','allergens','importerAddr']
      .filter(k => !PATHS[k]);
    if (miss.length) throw new Error(
      `[step2] NP.PATHS 미설정: ${miss.join(', ')}\n` +
      `        step1 출력에서 실제 경로를 확인해 지정하세요. 추측하지 않습니다.`);
    if (!CONFIG.TEMPLATE_LABEL_ID) throw new Error('[step2] CONFIG.TEMPLATE_LABEL_ID 필요');

    const items = NAPOLITAN.map(p => {
      const per = { ...CONFIG.DEFAULT, ...(CONFIG.PER_ITEM[p.flavor] || {}) };
      const ov = {};
      const put = (path, val) => { if (path && val !== undefined && val !== '') ov[path] = val; };

      put(PATHS.productName,  per.productName ?? p.flavor);
      put(PATHS.ingredients,  p.ingredients);
      put(PATHS.allergens,    p.allergens);
      put(PATHS.hsCode,       p.hsCode);
      put(PATHS.netWeight,    per.netWeight);
      put(PATHS.barcode,      per.barcode);
      put(PATHS.importer,     수입원_상호);
      put(PATHS.importerAddr, 수입원_소재지);     // ← 제조원은 템플릿 값 그대로 둔다
      for (const [k, path] of Object.entries(PATHS.nutrition || {})) put(path, p.nutrition[k]);

      if (!Object.keys(ov).length) throw new Error(`[step2] "${p.flavor}" 덮어쓸 값이 없습니다.`);
      return {
        templateLabelId: CONFIG.TEMPLATE_LABEL_ID,
        name: per.productName || p.flavor,
        productCode: per.productCode || '',
        series: p.series === '화이트' ? 'white' : 'darkmilk',
        sizeTag: per.netWeight || null,
        overrides: ov,
      };
    });

    const noCode = items.filter(i => !i.productCode).map(i => i.name);
    if (noCode.length) console.warn(`[step2] product_code 미지정 ${noCode.length}건 — PIM 연결이 안 됩니다: ${noCode.join(', ')}`);

    const dst = await LE.createFolder(CONFIG.DST_FOLDER_NAME, CONFIG.DST_PARENT_ID ?? null);
    const plan = CONFIG.MFG_DATE
      ? await LE.planNew({ dstFolderId: dst.id, mfgDate: CONFIG.MFG_DATE, items })
      : await planNoDate(dst.id, items);

    await LE.review(plan);
    window.__plan = plan; window.__dst = dst;
    console.log('%c다음', 'color:#06c;font-weight:bold',
      '\n  const res = await LE.apply(__plan, { confirm:"CREATE" })' +
      '\n  await LE.verify(res)        // MFG_DATE 를 넣었을 때만 의미 있음' +
      '\n  await LE.manifest(__dst.id)');
    return plan;
  };

  /** 제조일 미정일 때: 날짜 필드를 건드리지 않고 나머지만 덮어쓴다. */
  const planNoDate = async (dstFolderId, items) => {
    const start = (await LE.maxPosition(dstFolderId)) + 1;
    const tpl = await LE.getLabel(CONFIG.TEMPLATE_LABEL_ID);
    if (!tpl) throw new Error('템플릿 라벨을 찾지 못했습니다.');
    console.warn('[plan] MFG_DATE 가 비어 있어 제조일/소비기한을 템플릿 값 그대로 둡니다. ' +
                 '반드시 에디터에서 채우고 PDF 를 뽑으세요.');
    return items.map((it, i) => {
      const fd = JSON.parse(JSON.stringify(tpl.form_data));
      const changes = [];
      for (const [p, v] of Object.entries(it.overrides)) {
        const before = LE.setPath(fd, p, v);
        changes.push(`${p}: ${JSON.stringify(before)} → ${JSON.stringify(v)}`);
      }
      return {
        action: 'new', templateLabelId: CONFIG.TEMPLATE_LABEL_ID,
        name: it.name, productCode: it.productCode, sizeTag: it.sizeTag,
        series: it.series, shelfLifeMonths: it.series === 'white' ? 12 : 18,
        mfgDate: '(미설정)', bestByDate: '(미설정)', changes,
        row: {
          name: it.name, product_code: it.productCode, form_data: fd,
          folder_id: dstFolderId, position: start + i,
          user_id: LE_AUTH.UID,
          creator_email: LE_AUTH.EMAIL, modifier_email: LE_AUTH.EMAIL,
        },
      };
    });
  };

  window.NP = { CONFIG, PATHS, step1, step2, 수입원_상호, 수입원_소재지 };
  console.log('%c[05_run_napolitan] 준비 완료 — 14종', 'color:#06c;font-weight:bold',
    '\n  1) await NP.step1()               폴더 목록' +
    '\n  2) await NP.step1("<폴더명>")      템플릿 + 스키마' +
    '\n  3) NP.PATHS / NP.CONFIG 채우기' +
    '\n  4) await NP.step2()               계획' +
    '\n  5) await LE.apply(__plan,{confirm:"CREATE"})');
})();
