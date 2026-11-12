/* 규칙 엔진 검증 — node label-editor/test/rules.test.js
 * MD 4-1 의 예시와 사고 재발 방지 동작을 고정한다. */
const fs = require('fs');
const path = require('path');

global.window = {};
global.console = { ...console, table: () => {}, warn: () => {}, log: () => {} };
new Function(fs.readFileSync(path.join(__dirname, '../browser/02_core.js'), 'utf8'))();
const LE = global.window.LE;

let pass = 0, fail = 0;
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.info(`${ok ? 'PASS' : 'FAIL'}  ${name}` + (ok ? '' : `\n        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`));
};
const throws = (name, fn, re) => {
  try { fn(); fail++; console.info(`FAIL  ${name} — throw 하지 않았습니다`); }
  catch (e) {
    const ok = !re || re.test(e.message);
    ok ? pass++ : fail++;
    console.info(`${ok ? 'PASS' : 'FAIL'}  ${name}` + (ok ? '' : `\n        메시지: ${e.message}`));
  }
};

/* --- MD 4-1: 소비기한 = 제조일 + N개월 - 1일 --------------------------- */
eq('다크 18개월  2026-11-23 → 2028-05-22', LE.bestByFrom('2026-11-23', 18).date, '2028-05-22');
eq('화이트 12개월 2026-11-23 → 2027-11-22', LE.bestByFrom('2026-11-23', 12).date, '2027-11-22');
eq('연도 경계      2026-01-01 +12m → 2026-12-31', LE.bestByFrom('2026-01-01', 12).date, '2026-12-31');
eq('윤년 통과      2027-03-01 +12m → 2028-02-29', LE.bestByFrom('2027-03-01', 12).date, '2028-02-29');

/* 말일 보정: 8/31 + 6개월 → 2월에 31일이 없으므로 28일로 클램프 후 -1일 */
const clamp = LE.bestByFrom('2026-08-31', 6);
eq('말일 보정 날짜', clamp.date, '2027-02-27');
eq('말일 보정 플래그', clamp.clamped, true);

throws('날짜 형식 오류는 throw', () => LE.bestByFrom('2026/11/23', 18), /형식 오류/);

/* --- MD 4-1·4-2: 계열 판정 --------------------------------------------- */
eq('DHT-VLD58-5KG → darkmilk', LE.seriesOf('DHT-VLD58-5KG').id, 'darkmilk');
eq('DHT-VLW40-5KG → white',    LE.seriesOf('DHT-VLW40-5KG').id, 'white');
eq('DHT-LMW-1KG  → white',     LE.seriesOf('DHT-LMW-1KG').id,  'white');
eq('DHT-LMD-1KG  → darkmilk',  LE.seriesOf('DHT-LMD-1KG').id,  'darkmilk');
eq('DHT-VLM38-5KG → darkmilk', LE.seriesOf('DHT-VLM38-5KG').id,'darkmilk');

eq('화이트 HS CODE',     LE.seriesOf('DHT-VLW40-5KG').hsCode, '1704.90-9000');
eq('다크·밀크 HS CODE',  LE.seriesOf('DHT-VLD58-5KG').hsCode, '1806.20-1000');
eq('화이트 12개월',      LE.seriesOf('DHT-LMW-1KG').shelfLifeMonths, 12);
eq('다크·밀크 18개월',   LE.seriesOf('DHT-VLD58-5KG').shelfLifeMonths, 18);

throws('미등록 코드는 추측하지 않고 throw', () => LE.seriesOf('DHT-XYZ99-5KG'), /판정할 수 없습니다/);
throws('product_code 없으면 throw',        () => LE.seriesOf(null),             /계열을 판정할 수 없습니다/);
eq('series 명시 오버라이드', LE.seriesOf('DHT-XYZ99-5KG', 'white').id, 'white');

/* --- MD 4-3: 10kg 카톤 대상은 58% 다크 / 40% 화이트 2종뿐 --------------- */
eq('58% 다크 카톤 대상',   LE.isCartonEligible('DHT-VLD58-5KG'), true);
eq('40% 화이트 카톤 대상', LE.isCartonEligible('DHT-VLW40-5KG'), true);
eq('65% 다크 카톤 아님',   LE.isCartonEligible('DHT-VLD65-5KG'), false);
eq('38% 밀크 카톤 아님',   LE.isCartonEligible('DHT-VLM38-5KG'), false);
eq('루미에르 카톤 아님',   LE.isCartonEligible('DHT-LMD-5KG'),   false);

/* --- MD 3장: 필드명 함정 — 기본 경로가 뒤바뀌지 않았는지 고정 ---------- */
eq('PATHS.mfgDate = productInfo.expiryDate', LE.PATHS.mfgDate, 'productInfo.expiryDate');
eq('PATHS.bestBy  = productInfo.bestByDate', LE.PATHS.bestBy,  'productInfo.bestByDate');

/* --- setPath: 없는 경로는 조용히 만들지 않는다 ------------------------- */
const fd = { productInfo: { expiryDate: '2026-10-10', bestByDate: '2028-04-09' }, nutrition: { rows: [{ name: '열량', value: '520' }] } };
eq('setPath 반환값은 이전 값', LE.setPath(fd, 'productInfo.expiryDate', '2026-11-23'), '2026-10-10');
eq('setPath 적용 확인',        LE.getPath(fd, 'productInfo.expiryDate'), '2026-11-23');
eq('배열 인덱스 경로',         LE.getPath(fd, 'nutrition.rows[0].name'), '열량');
throws('오타 경로는 throw',    () => LE.setPath(fd, 'productInfo.expiryDat', 'x'), /경로 없음/);
throws('없는 중간 경로 throw', () => LE.setPath(fd, 'allergenInfo.text', 'x'),     /경로 없음/);

/* --- 사고 7-2: Chrome 동명 파일 접미사 규칙 ---------------------------- */
const dl = (name, nth) => (nth === 0 ? `${name}.pdf` : `${name} (${nth}).pdf`);
eq('첫 파일은 접미사 없음', dl('벨벳 58% 다크', 0), '벨벳 58% 다크.pdf');
eq('두 번째는 (1)',        dl('벨벳 58% 다크', 1), '벨벳 58% 다크 (1).pdf');
eq('세 번째는 (2)',        dl('벨벳 58% 다크', 2), '벨벳 58% 다크 (2).pdf');

console.info(`\n${fail ? 'FAILED' : 'OK'} — pass ${pass}, fail ${fail}`);
process.exit(fail ? 1 : 0);
