/* ============================================================================
 * 04_run_new.js — 신규제품 라벨 생성 (복제할 원본이 없을 때)
 * ----------------------------------------------------------------------------
 * 전제: 01_auth.js → 02_core.js 실행 완료.
 *
 * 신규제품은 form_data 를 처음부터 만들 수 없다 (원재료·영양성분·알레르기·바코드
 * 필드 구조를 임의로 만들면 화면에 렌더링되지 않거나 빈 라벨이 나온다).
 * 그래서 "가장 가까운 기존 라벨을 템플릿으로 쓰고, 달라지는 필드만 경로 단위로
 * 덮어쓴다". 경로 오타는 throw 되므로 조용히 틀린 라벨이 나오지 않는다.
 *
 * ── 진행 순서 ──────────────────────────────────────────────────────────────
 *   STEP 1  템플릿 후보를 찾고 form_data 전체 경로를 눈으로 확인
 *   STEP 2  확인한 경로로 ITEMS 를 채움
 *   STEP 3  계획 → 검토 → 생성 → 검증
 * ========================================================================== */

/* ===========================================================================
 * STEP 1 — 템플릿 탐색 & 스키마 확인   (이 블록만 먼저 실행하세요)
 * ======================================================================== */
window.STEP1 = async (folderName = '20261123') => {
  const f = await LE.findFolder(folderName);
  if (!f) throw new Error(`폴더 "${folderName}" 없음. LE.listFolders() 로 확인하세요.`);
  const labels = await LE.listLabels(f.id);
  console.table(labels.map(l => ({ id: l.id, name: l.name, product_code: l.product_code })));

  const tpl = labels[0];
  console.log(`%c템플릿 예시: ${tpl.name} (${tpl.id})`, 'font-weight:bold');
  console.log('%c--- form_data 전체 경로 ---', 'font-weight:bold');
  LE.dumpSchema(tpl);

  console.log('%c--- 블록별로 좁혀 보기 ---', 'font-weight:bold');
  for (const b of ['productInfo', 'ingredients', 'nutrition', 'companyInfo', 'allergenInfo', 'notes']) {
    console.log(`\n[${b}]`); LE.dumpSchema(tpl, { filter: new RegExp('^' + b) });
  }

  console.log('%c--- 주요 값으로 경로 역추적 ---', 'font-weight:bold');
  console.log('HS CODE:');  LE.findPath(tpl, /1806\.20|1704\.90/);
  console.log('내용량:');    LE.findPath(tpl, /\d[\d,]*\s*g/);
  LE.discoverPaths(tpl);

  window.__tplId = tpl.id;
  console.log('\n위 경로를 보고 STEP 2 의 ITEMS.overrides 를 채우세요. (window.__tplId 에 템플릿 id 저장)');
  return { folder: f, labels, template: tpl };
};

/* ===========================================================================
 * STEP 2 — 신규제품 정의
 * ---------------------------------------------------------------------------
 * overrides 의 key 는 STEP 1 에서 "실제로 본" 경로여야 한다. 추측 금지.
 * 제조일/소비기한/HS CODE 는 적지 않는다 — 계열 규칙으로 자동 설정된다.
 * ======================================================================== */
window.ITEMS = [
  // ── 예시 (실제 값으로 바꿔 쓰세요) ─────────────────────────────────────
  // {
  //   templateLabelId: window.__tplId,          // 가장 가까운 기존 라벨
  //   name:        '벨벳 45% 밀크 (Velvet 45% Milk)',
  //   productCode: 'DHT-VLM45-5KG',
  //   sizeTag:     '5kg',                        // PDF 파일명 접미사
  //   overrides: {
  //     'productInfo.productName'   : '벨벳 45% 밀크',
  //     'productInfo.netWeight'     : '5,000g',
  //     'productInfo.barcode'       : '8809...',
  //     'ingredients.text'          : '설탕, 전지분유, 코코아매스, ...',
  //     'allergenInfo.text'         : '우유, 대두 함유',
  //     'nutrition.rows[0].value'   : '560',
  //   },
  // },
];

/* ===========================================================================
 * STEP 2-b — 10kg 카톤 라벨 (MD 4-3)
 * ---------------------------------------------------------------------------
 * 5kg x 2 라인은 라벨 2장. 단 카톤 라벨 대상은 58% 다크 / 40% 화이트 2종뿐.
 * 5kg 라벨을 템플릿으로 쓰고 내용량만 "5,000g x 2" 로 바꾼다.
 * ======================================================================== */
window.cartonItem = (baseLabel, { netWeightPath = LE.PATHS.netWeight, netWeight = '5,000g x 2' } = {}) => {
  if (!LE.isCartonEligible(baseLabel.product_code))
    throw new Error(`[carton] ${baseLabel.product_code} 는 카톤 라벨 대상이 아닙니다 (58% 다크 / 40% 화이트만).`);
  if (!netWeightPath)
    throw new Error('[carton] 내용량 경로를 모릅니다. STEP 1 로 확인한 뒤 LE.PATHS.netWeight 를 지정하거나 netWeightPath 를 넘기세요.');
  return {
    templateLabelId: baseLabel.id,
    name: baseLabel.name,
    productCode: baseLabel.product_code,
    sizeTag: '10kg(5kgx2)',
    overrides: { [netWeightPath]: netWeight },
  };
};

/* ===========================================================================
 * STEP 3 — 계획 → 검토 → 생성 → 검증
 * ======================================================================== */
window.STEP3 = async ({ dstFolderName, mfgDate }) => {
  if (!window.ITEMS.length) throw new Error('ITEMS 가 비어 있습니다. STEP 2 를 채우세요.');
  const dst = await LE.createFolder(dstFolderName);
  const plan = await LE.planNew({ dstFolderId: dst.id, mfgDate, items: window.ITEMS });
  await LE.review(plan);

  window.__plan = plan; window.__dst = dst;
  console.log(
    '%c다음 단계', 'color:#06c;font-weight:bold',
    '\n  const res = await LE.apply(__plan, { confirm: "CREATE" })' +
    '\n  await LE.verify(res)' +
    '\n  await LE.manifest(__dst.id)'
  );
  return plan;
};

console.log('%c[04_run_new] 준비 완료', 'color:#06c;font-weight:bold',
  '\n  STEP 1:  await STEP1("20261123")        // 템플릿 & 스키마 확인' +
  '\n  STEP 2:  ITEMS 배열을 채움 (경로는 STEP 1 에서 본 것만)' +
  '\n  STEP 3:  await STEP3({ dstFolderName:"20270115", mfgDate:"2027-01-15" })');
