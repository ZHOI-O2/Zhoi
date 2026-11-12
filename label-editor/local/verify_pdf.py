#!/usr/bin/env python3
"""라벨 PDF 육안 검증 보조 (MD 6-2).

생성된 PDF 는 이미지라 텍스트 추출이 되지 않는다. 상단 일부를 크롭 렌더링해
내용량·제조일·소비기한을 눈으로 대조한다. manifest.json 을 주면 "기대값"을
크롭 옆에 같이 띄워 비교 리뷰 HTML 을 만든다.

설치:  pip install pymupdf
사용:
  python verify_pdf.py --dir "G:\\...\\Cont No 17\\Label" --manifest manifest.json
  python verify_pdf.py --dir ./out --top 0.25 --bottom 0.50 --open
"""
from __future__ import annotations

import argparse
import base64
import hashlib
import html
import json
import sys
from collections import defaultdict
from pathlib import Path

try:                        # 신버전 패키지명 우선 (fitz 별칭은 deprecated)
    import pymupdf as fitz
except ImportError:
    try:
        import fitz  # type: ignore
    except ImportError:
        sys.exit("PyMuPDF 가 없습니다:  pip install pymupdf")


def crop_png(pdf: Path, top: float, bottom: float, scale: float) -> tuple[bytes, int, str]:
    """1페이지의 top~bottom 구간을 PNG 로 렌더링. (png, 추출된 텍스트 길이, 오류)"""
    try:
        doc = fitz.open(pdf)
    except Exception as e:
        return b"", 0, f"열기 실패: {e}"
    try:
        if doc.page_count == 0:
            return b"", 0, "페이지 없음"
        page = doc[0]
        r = page.rect
        clip = fitz.Rect(r.x0, r.y0 + r.height * top, r.x1, r.y0 + r.height * bottom)
        pix = page.get_pixmap(matrix=fitz.Matrix(scale, scale), clip=clip)
        text_len = len((page.get_text() or "").strip())
        return pix.tobytes("png"), text_len, ""
    except Exception as e:
        return b"", 0, f"렌더 실패: {e}"
    finally:
        doc.close()


def main() -> int:
    ap = argparse.ArgumentParser(description="라벨 PDF 크롭 검증")
    ap.add_argument("--dir", required=True, help="PDF 폴더")
    ap.add_argument("--manifest", help="LE.manifest() 로 받은 manifest.json (기대값 대조)")
    ap.add_argument("--out", help="출력 폴더 (기본: <dir>/_verify)")
    ap.add_argument("--top", type=float, default=0.30, help="크롭 시작 비율 (기본 0.30)")
    ap.add_argument("--bottom", type=float, default=0.42, help="크롭 끝 비율 (기본 0.42)")
    ap.add_argument("--scale", type=float, default=2.0, help="렌더 배율 (기본 2)")
    ap.add_argument("--open", action="store_true", help="완료 후 리뷰 HTML 열기")
    a = ap.parse_args()

    if not (0.0 <= a.top < a.bottom <= 1.0):
        return print("--top/--bottom 은 0 ≤ top < bottom ≤ 1 이어야 합니다.") or 2

    src = Path(a.dir)
    if not src.is_dir():
        return print(f"폴더 없음: {src}") or 2

    out = Path(a.out) if a.out else src / "_verify"
    out.mkdir(parents=True, exist_ok=True)

    pdfs = sorted(p for p in src.glob("*.pdf") if p.is_file())
    if not pdfs:
        return print(f"PDF 가 없습니다: {src}") or 2

    # manifest: 최종 파일명 → 기대값
    expected: dict[str, dict] = {}
    if a.manifest:
        man = json.loads(Path(a.manifest).read_text(encoding="utf-8"))
        expected = {e["targetName"]: e for e in man.get("clickOrder", [])}
        print(f"manifest: {man.get('folder', {}).get('name')}  기대 {man.get('expectedCount')}건  "
              f"제조일 {man.get('mfgDate')}")

    rows, by_hash = [], defaultdict(list)
    print(f"\n{len(pdfs)}개 PDF 처리 — 크롭 {a.top:.0%}~{a.bottom:.0%}\n")

    for p in pdfs:
        size = p.stat().st_size
        md5 = hashlib.md5(p.read_bytes()).hexdigest()
        by_hash[md5].append(p.name)
        png, text_len, err = crop_png(p, a.top, a.bottom, a.scale)
        if png:
            (out / f"{p.stem}.png").write_bytes(png)

        exp = expected.get(p.name)
        notes = []
        if size == 0:
            notes.append("0바이트")
        if err:
            notes.append(err)
        if a.manifest and exp is None:
            notes.append("manifest 에 없는 파일")
        if text_len > 20:
            notes.append(f"텍스트 추출됨({text_len}자) — 이미지 라벨이 아닐 수 있음")

        rows.append({
            "file": p.name, "size": size, "md5": md5[:8].upper(),
            "png": f"{p.stem}.png" if png else None,
            "b64": base64.b64encode(png).decode() if png else None,
            "exp": exp, "notes": notes,
        })
        print(f"  {'!' if notes else ' '} {p.name}  ({size:,}B, {md5[:8].upper()})"
              + (f"   ← {', '.join(notes)}" if notes else ""))

    dup = {h: n for h, n in by_hash.items() if len(n) > 1}
    missing = [n for n in expected if n not in {r['file'] for r in rows}] if a.manifest else []

    # ---- 리뷰 HTML ---------------------------------------------------------
    def cell(r: dict) -> str:
        e = r["exp"] or {}
        exp_html = ""
        if e:
            exp_html = (
                "<dl>"
                f"<dt>내용량</dt><dd>{html.escape(str(e.get('netWeight') or '—'))}</dd>"
                f"<dt>제조일</dt><dd>{html.escape(str(e.get('mfgDate') or '—'))}</dd>"
                f"<dt>소비기한</dt><dd>{html.escape(str(e.get('bestByDate') or '—'))}</dd>"
                f"<dt>제품코드</dt><dd>{html.escape(str(e.get('productCode') or '—'))}</dd>"
                "</dl>"
            )
        img = (f'<img src="data:image/png;base64,{r["b64"]}" alt="{html.escape(r["file"])} 상단 크롭">'
               if r["b64"] else '<p class="err">렌더 실패</p>')
        note = (f'<p class="warn">{html.escape(", ".join(r["notes"]))}</p>' if r["notes"] else "")
        return (f'<section{" class=flag" if r["notes"] else ""}>'
                f'<h2>{html.escape(r["file"])}</h2>'
                f'<p class="meta">{r["size"]:,} bytes · MD5 {r["md5"]}</p>'
                f'{note}<div class="pair">{img}<div class="exp"><h3>기대값(manifest)</h3>{exp_html or "<p>—</p>"}</div></div>'
                "</section>")

    head = (
        f'<p>PDF {len(rows)}개 · 크롭 {a.top:.0%}~{a.bottom:.0%}</p>'
        f'<p class="{"err" if dup else "ok"}">MD5 중복: {len(dup)}그룹'
        + ("".join(f"<br>· {html.escape(', '.join(v))}" for v in dup.values()) if dup else "")
        + "</p>"
        + (f'<p class="err">manifest 에 있으나 파일이 없음: {html.escape(", ".join(missing))}</p>' if missing else "")
    )

    doc = f"""<!doctype html><html lang="ko"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>라벨 PDF 검증</title><style>
:root{{--bg:#fff;--fg:#1a1a1a;--mut:#666;--line:#e3e3e3;--card:#fafafa;--err:#b3261e;--warn:#8a5a00;--ok:#1b5e20}}
@media(prefers-color-scheme:dark){{:root:not([data-theme=light]){{--bg:#161616;--fg:#eee;--mut:#aaa;--line:#333;--card:#1f1f1f;--err:#f2b8b5;--warn:#f0c674;--ok:#a5d6a7}}}}
body{{background:var(--bg);color:var(--fg);font:15px/1.6 system-ui,'Malgun Gothic',sans-serif;margin:0;padding:24px 16px;max-width:1100px;margin-inline:auto}}
h1{{font-size:1.4rem;margin:0 0 4px}} .sum{{border:1px solid var(--line);border-radius:8px;padding:12px 16px;margin-bottom:24px;background:var(--card)}}
section{{border:1px solid var(--line);border-radius:8px;padding:16px;margin-bottom:20px;background:var(--card)}}
section.flag{{border-color:var(--warn);border-width:2px}}
h2{{font-size:1rem;margin:0 0 2px;word-break:break-all}} h3{{font-size:.8rem;margin:0 0 6px;color:var(--mut);text-transform:uppercase;letter-spacing:.05em}}
.meta{{color:var(--mut);font-size:.8rem;margin:0 0 10px}}
.pair{{display:flex;gap:16px;flex-wrap:wrap;align-items:flex-start}}
.pair img{{flex:1 1 420px;min-width:0;max-width:100%;border:1px solid var(--line);border-radius:4px;background:#fff}}
.exp{{flex:0 1 220px}} dl{{margin:0;display:grid;grid-template-columns:auto 1fr;gap:2px 10px;font-size:.9rem}}
dt{{color:var(--mut)}} dd{{margin:0;font-variant-numeric:tabular-nums}}
.err{{color:var(--err);font-weight:600}} .warn{{color:var(--warn);font-weight:600;margin:0 0 8px}} .ok{{color:var(--ok)}}
@media(max-width:620px){{.pair{{flex-direction:column}}body{{padding:16px}}}}
</style>
<h1>라벨 PDF 검증</h1><div class="sum">{head}</div>
{"".join(cell(r) for r in rows)}
<p class="meta">내용량 · 제조일 · 소비기한을 크롭과 기대값으로 대조하세요. 불일치가 있으면 해당 라벨을 라벨에디터에서 다시 확인합니다.</p>
</html>"""

    report = out / "review.html"
    report.write_text(doc, encoding="utf-8")

    print(f"\n크롭 PNG : {out}")
    print(f"리뷰 HTML: {report}")
    print(f"MD5 중복 : {len(dup)}그룹" + (" ← 확인 필요" if dup else ""))
    if missing:
        print(f"누락     : {', '.join(missing)}")

    if a.open:
        import webbrowser
        webbrowser.open(report.as_uri())

    return 1 if (dup or missing or any(r["notes"] for r in rows)) else 0


if __name__ == "__main__":
    sys.exit(main())
