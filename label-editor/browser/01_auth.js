/* ============================================================================
 * 01_auth.js — 라벨에디터 인증 확보  (MD 5-1 단계)
 * ----------------------------------------------------------------------------
 * 사용법: label.o2veluto.com 에 "로그인된" Chrome 탭의 DevTools 콘솔에 전체 붙여넣기.
 * 결과:   window.LE_AUTH = { ANON, TOKEN, UID, EMAIL, expiresAt, H, B, check() }
 *
 * 주의 (MD 5-1):
 *   - apikey 에 access_token 을 넣으면 401 Invalid API key. 반드시 anon(publishable) key.
 *   - window.fetch 몽키패치로 헤더를 가로채는 방식은 내가 보낸 테스트 요청까지 섞여서
 *     혼동된다. 번들 스크립트에서 정규식으로 뽑는 쪽이 확실하다.
 * ========================================================================== */
(async () => {
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
})();
