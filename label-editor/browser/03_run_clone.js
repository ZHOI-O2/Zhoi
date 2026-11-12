/* ============================================================================
 * 03_run_clone.js — 기존 제품 "다음 차수" 라벨 일괄 생성  (MD 10장 1~6단계)
 * ----------------------------------------------------------------------------
 * 전제: 01_auth.js → 02_core.js 실행 완료.
 * 아래 CONFIG 만 고치고 전체를 콘솔에 붙여넣으면 "계획"까지만 만든다.
 * 실제 쓰기는 마지막에 안내되는 LE.apply(...) 를 직접 호출해야 일어난다.
 * ========================================================================== */
(async () => {
  'use strict';

  /* ======================= CONFIG — 여기만 고치세요 ======================= */
  const CONFIG = {
    SRC_FOLDER_NAME: '20261123',   // 복제 원본 (직전 차수) 폴더명
    DST_FOLDER_NAME: '20270115',   // 새로 만들 폴더명 = 발주일
    MFG_DATE:        '2027-01-15', // 제조일 (YYYY-MM-DD) — 소비기한은 계열 규칙으로 자동 계산
    // 원본에서 일부만 복제할 때. 전부면 null.
    // 예) 오퍼시트에 없는 품목 제외: (l) => !/루미에르 밀크/.test(l.name)
    ONLY: null,
  };
  /* ======================================================================= */

  if (!window.LE) throw new Error('02_core.js 를 먼저 실행하세요.');

  console.log('%c[1/4] 원본 폴더 확인', 'font-weight:bold');
  const src = await LE.findFolder(CONFIG.SRC_FOLDER_NAME);
  if (!src) throw new Error(`원본 폴더 "${CONFIG.SRC_FOLDER_NAME}" 을 찾지 못했습니다. LE.listFolders() 로 확인하세요.`);
  const srcLabels = await LE.listLabels(src.id);
  console.log(`  "${src.name}" (${src.id}) — 라벨 ${srcLabels.length}건`);
  console.table(srcLabels.map((l, i) => ({ '#': i + 1, name: l.name, product_code: l.product_code, position: l.position })));

  console.log('%c[2/4] 필드 경로 발견 (추측하지 않음)', 'font-weight:bold');
  LE.discoverPaths(srcLabels[0]);

  console.log('%c[3/4] 대상 폴더 준비', 'font-weight:bold');
  const dst = await LE.createFolder(CONFIG.DST_FOLDER_NAME);   // 이미 있으면 기존 폴더 재사용

  console.log('%c[4/4] 계획 수립 (쓰기 없음)', 'font-weight:bold');
  const plan = await LE.planClone({
    srcFolderId: src.id,
    dstFolderId: dst.id,
    mfgDate: CONFIG.MFG_DATE,
    only: CONFIG.ONLY,
  });
  await LE.review(plan);

  window.__plan = plan;
  console.log(
    '%c다음 단계', 'color:#06c;font-weight:bold',
    '\n  1) 위 표에서 제조일/소비기한/계열이 맞는지 확인' +
    '\n  2) const res = await LE.apply(__plan, { confirm: "CREATE" })' +
    '\n  3) await LE.verify(res)' +
    `\n  4) await LE.manifest("${dst.id}")   // manifest.json 다운로드 → PDF 리네임 기준` +
    '\n\n  ※ 10kg 카톤 라벨이 필요한 품목(58% 다크 / 40% 화이트)은 ' +
    '04_run_new.js 의 카톤 섹션으로 별도 생성하세요.'
  );
})();
