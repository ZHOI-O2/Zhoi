# 라벨에디터 구동 로직

[라벨에디터(label.o2veluto.com)](https://label.o2veluto.com/) 라벨 일괄 생성·검증 자동화.
2026-10-28 작업 기록(16차 PDF 저장 / 17차 자동 생성)에서 확정된 규칙과 사고 2건의 재발 방지책을 코드로 옮긴 것.

## 전제

- 라벨에디터는 **PIM과 같은 Supabase 프로젝트**(`svcnbqyetbenavwxakmn`)를 쓴다. 별도 DB가 아니므로 REST API로 직접 제어한다.
- 서버 키가 없으므로 **로그인된 Chrome의 세션**을 빌린다 → 브라우저 콘솔에서 실행.
- PDF 저장·파일 이동은 로컬 PC에서만 가능하다 (클라우드 세션 불가).

## 파일 구성

| 파일 | 실행 위치 | 역할 |
|---|---|---|
| `browser/01_auth.js` | Chrome 콘솔 | `ANON` / `TOKEN` / `UID` 확보, 헤더 검증 |
| `browser/02_core.js` | Chrome 콘솔 | 코어 라이브러리 (`window.LE`) — 규칙 엔진·스키마 발견·계획/실행 |
| `browser/03_run_clone.js` | Chrome 콘솔 | **기존 제품 다음 차수** 일괄 복제 |
| `browser/04_run_new.js` | Chrome 콘솔 | **신규제품** 생성 (템플릿 + 경로 오버라이드) |
| `local/rename_move.ps1` | PowerShell | manifest 기준 리네임·이동 + 사전/사후 전수 검증 |
| `local/verify_pdf.py` | Python | 상단 크롭 렌더링 + 기대값 대조 리뷰 HTML 생성 |
| `config/new_products.sample.json` | — | 신규제품 표시사항 입력 양식 |
| `test/rules.test.js` | Node | 규칙 엔진 검증 (`node test/rules.test.js`) |

---

## A. 기존 제품 — 다음 차수 라벨 만들기

```
1. label.o2veluto.com 로그인된 탭 → F12 콘솔
2. 01_auth.js 붙여넣기            → [auth] OK + 토큰 잔여시간 확인
3. 02_core.js 붙여넣기            → [core] LE 준비 완료
4. 03_run_clone.js 의 CONFIG 수정 후 붙여넣기
      SRC_FOLDER_NAME : 직전 차수 폴더 (예 20261123)
      DST_FOLDER_NAME : 새 폴더 = 발주일 (예 20270115)
      MFG_DATE        : 제조일
   → 계획 표 출력 (쓰기 없음). 제조일/소비기한/계열을 눈으로 확인.
5. const res = await LE.apply(__plan, { confirm: "CREATE" })
6. await LE.verify(res)           → 되읽어 날짜 전수 대조
7. await LE.manifest(__dst.id)    → manifest.json 다운로드
```

그다음 PDF (아래 C).

## B. 신규제품 — 복제할 원본이 없을 때

신규제품은 `form_data`를 처음부터 만들 수 없다. 원재료·영양성분·알레르기·바코드 블록의
내부 필드 구조를 임의로 만들면 화면에 렌더링되지 않거나 빈 라벨이 나온다.
그래서 **가장 가까운 기존 라벨을 템플릿으로 쓰고, 달라지는 필드만 경로 단위로 덮어쓴다.**

```
1~3. A 와 동일 (01_auth.js → 02_core.js)
4.   04_run_new.js 붙여넣기
5.   await STEP1("20261123")
     → 라벨 목록 + form_data 전체 경로가 표로 뜬다.
       여기서 '실제' 필드명을 눈으로 확인한다. 추측하지 않는다.
6.   ITEMS 배열을 채운다 (경로는 5에서 본 것만 사용)
7.   await STEP3({ dstFolderName: "20270115", mfgDate: "2027-01-15" })
8.   const res = await LE.apply(__plan, { confirm: "CREATE" })
     await LE.verify(res)
     await LE.manifest(__dst.id)
```

필요한 표시사항 항목은 `config/new_products.sample.json` 참고.
**제조일·소비기한·HS CODE는 입력하지 않는다** — 계열 규칙으로 자동 계산된다.

### 스키마를 발견하는 도구

```js
LE.dumpSchema(label)                       // form_data 전체 경로 표
LE.dumpSchema(label, { filter: /^nutrition/ })  // 블록별로 좁혀 보기
LE.findPath(label, '1806.20')              // 값 → 경로 역추적 (HS CODE 위치 찾기)
LE.discoverPaths(label)                    // netWeight / hsCode 경로 자동 추정
```

## C. PDF 저장 → 리네임 → 검증

```
1. Chrome 다운로드 폴더를 "전용 빈 스테이징 폴더"로 바꾼다.   ← 사고 7-2 차단의 핵심
   (설정 → 다운로드 → 위치 변경)
2. manifest.json 을 그 폴더에 둔다.
3. 카드별 [PDF 저장] 을 manifest 의 seq 순서대로, 4건 이하씩 클릭.
4. 리네임 계획 확인 (dry-run):
     .\rename_move.ps1 -Staging 'C:\...\_label_stage' -Manifest 'C:\...\_label_stage\manifest.json'
5. 적용 + 공유드라이브 이동:
     .\rename_move.ps1 -Staging 'C:\...\_label_stage' -Manifest 'C:\...\manifest.json' `
                       -Dest 'G:\공유 드라이브\...\Cont No 17\Label' -Apply
6. 육안 검증:
     python verify_pdf.py --dir "G:\...\Cont No 17\Label" --manifest manifest.json --open
```

`verify_pdf.py` 는 각 PDF 상단 30~42%를 크롭 렌더링해 manifest의 기대값(내용량·제조일·소비기한·제품코드)과
나란히 놓은 `review.html` 을 만든다. 생성된 PDF는 이미지라 텍스트 추출이 안 되므로 육안 대조가 필요하다.

---

## 규칙 (코드에 반영됨)

### 소비기한 = 제조일 + N개월 − 1일

| 계열 | 개월 | 예 (제조일 2026-11-23) |
|---|---|---|
| 다크 · 밀크 | 18 | 2028-05-22 |
| 화이트 (`DHT-*W*`) | 12 | 2027-11-22 |

### HS CODE

| 계열 | HS CODE |
|---|---|
| 다크 · 밀크 | `1806.20-1000` |
| 화이트 | `1704.90-9000` |

### 10kg 카톤 라벨

오퍼시트의 `5kg x 2` 라인은 라벨 2장(5kg 내포장 + 10kg 카톤 `5,000g x 2`).
단 **카톤 라벨 대상은 벨벳 58% 다크 / 벨벳 40% 화이트 2종뿐**(2026-10-28 확인).
나머지 `5kg x 2`, `1kg x 8`, `400g x 18` 라인은 낱개 라벨만.

### 필드명 함정

```
productInfo.expiryDate   →  제조일    (!!)
productInfo.bestByDate   →  소비기한  (!!)
```

이름이 뒤바뀐 것처럼 보이지만 화면 렌더링 기준으로 이게 맞다.
`test/rules.test.js` 가 이 매핑을 고정하고 있으므로 임의로 바꾸면 테스트가 깨진다.

---

## 사고 방지 장치

| 사고 | 원인 | 코드의 대응 |
|---|---|---|
| **7-1** 파일 5개 유실 | 라벨명의 대괄호 `[...]`를 PowerShell이 와일드카드로 해석 → **에러 없이** 조용히 실패 | `rename_move.ps1` 의 모든 파일 조작에 `-LiteralPath` |
| **7-2** 순서 한 칸 밀림 | Downloads 잔존 동명 파일이 타임스탬프 윈도우에 섞임 + index 매핑 | index 매핑 폐기. `manifest.json` 의 `downloadName`(Chrome `(n)` 접미사 포함)으로 명시 매칭. 빈 스테이징 폴더 강제. 개수·여분·MD5 중복 사전 점검. 하나라도 어긋나면 **파일을 건드리지 않고 중단** |
| 잘못된 계열 판정 | 소비기한 12/18개월, HS CODE가 갈림 | 미등록 `product_code` 는 추측하지 않고 `throw` |
| 경로 오타 | 없는 필드에 값이 들어가 화면에 안 찍힘 | `setPath` 가 없는 경로에 쓰면 `throw` |
| 의도치 않은 쓰기 | — | `LE.plan*()` 은 절대 쓰지 않음. `LE.apply(plan, { confirm:'CREATE' })` 만 POST |

## 주의

- **anon key 자리에 `access_token` 을 넣으면 `401 Invalid API key`.** `01_auth.js` 가 이 경우를 막는다.
- access_token 은 보통 1시간 만료. 긴 작업 전에 페이지를 새로고침해 갱신할 것.
- `window.fetch` 몽키패치로 헤더를 가로채는 방식은 내가 보낸 테스트 요청까지 섞인다. 번들에서 정규식으로 뽑는 쪽이 확실하다.
- 표시사항은 법적 책임이 있다. **원재료·영양성분·알레르기를 추측으로 채우지 않는다.** 코드도 그렇게 하지 않도록 막아 두었다.

## 테스트

```bash
node test/rules.test.js      # 규칙 엔진 34개 검증 (MD 4-1 예시 날짜 포함)
```
