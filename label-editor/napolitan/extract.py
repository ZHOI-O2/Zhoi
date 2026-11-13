"""나폴리탄 규격서 추출 — 행 위치를 라벨로 탐색 (시트마다 시작 행이 다름)."""
import openpyxl, json, csv, re, sys

NUT = ['Energy','Carbohydrates','Sugar','Fat','Trans Fat','Saturated Fat',
       'Cholesterol','Protein','Sodium']
SAMPLE = re.compile(r'^#\s*([\d.\-]+)\s*:?\s*(.*)$')

def norm(v):
    return re.sub(r'\s+', ' ', str(v).strip()) if v not in (None, '') else ''

def extract(ws):
    g = lambda r, c: norm(ws.cell(row=r, column=c).value)
    maxr = ws.max_row

    # A1 = 샘플번호 + 배합
    m = SAMPLE.match(g(1, 1))
    sample, comp = (m.group(1), m.group(2)) if m else ('', g(1, 1))

    # 원재료 표: 헤더행("NO" + "List of Ingredients") ~ TOTAL행
    hdr = next((r for r in range(1, maxr + 1)
                if g(r, 1).upper() == 'NO' and 'LIST OF INGREDIENTS' in g(r, 3).upper()), None)
    tot = next((r for r in range(hdr + 1, maxr + 1) if g(r, 1).upper() == 'TOTAL'), None) if hdr else None

    ing, group = [], ''
    if hdr and tot:
        for r in range(hdr + 1, tot):
            if g(r, 2): group = g(r, 2)          # 그룹(커버추어) 라벨은 첫 행에만 있고 이어짐
            nm = g(r, 3)
            if not nm: continue
            ing.append({'no': g(r, 1), 'group': group, 'name': nm, 'pct': g(r, 8)})
    total_pct = g(tot, 8) if tot else ''

    # 영양성분: A열 라벨로 직접 탐색
    nut = {}
    for r in range(1, maxr + 1):
        k = g(r, 1)
        if k in NUT and k not in nut:
            nut[k] = {'value': g(r, 3), 'unit': g(r, 4), 'row': r}

    find = lambda pre: next((g(r, c) for r in range(1, maxr + 1) for c in (1, 2, 3)
                             if g(r, c).startswith(pre)), '')
    return {
        'sample': sample, 'composition': comp,
        'ingredients': ing, 'ingredientTotal': total_pct,
        'nutrition': nut,
        'shelflife': find('Shelflife'), 'storage': find('Storage temperature'),
        'keep': find('Keep '),
        'headerRow': hdr, 'totalRow': tot,
    }

def main(path):
    wb = openpyxl.load_workbook(path, data_only=True)
    return [{'flavor': n, **extract(wb[n])} for n in wb.sheetnames]

if __name__ == '__main__':
    rows = main(sys.argv[1] if len(sys.argv) > 1 else '나폴리탄_규격서_14종.xlsx')
    json.dump(rows, open('나폴리탄_14종_추출.json', 'w', encoding='utf-8'),
              ensure_ascii=False, indent=1)

    with open('나폴리탄_14종_영양성분.csv', 'w', newline='', encoding='utf-8-sig') as f:
        w = csv.writer(f)
        w.writerow(['맛명칭','샘플번호','배합'] + NUT + ['유통기한','보관온도'])
        for r in rows:
            w.writerow([r['flavor'], r['sample'], r['composition']]
                       + [r['nutrition'].get(n, {}).get('value', '') for n in NUT]
                       + [r['shelflife'].replace('Shelflife:', '').strip(),
                          r['storage'].replace('Storage temperature:', '').strip()])

    with open('나폴리탄_14종_원재료.csv', 'w', newline='', encoding='utf-8-sig') as f:
        w = csv.writer(f)
        w.writerow(['맛명칭','샘플번호','번호','그룹(커버추어)','원재료','%'])
        for r in rows:
            for i in r['ingredients']:
                w.writerow([r['flavor'], r['sample'], i['no'], i['group'], i['name'], i['pct']])

    print(f"{'맛명칭':<16}{'샘플':<7}{'원재료':>4}{'합계%':>9}{'표기TOTAL':>10}{'영양항목':>7}")
    print('-' * 62)
    for r in rows:
        s = sum(float(i['pct']) for i in r['ingredients'] if i['pct'])
        print(f"{r['flavor']:<16}{r['sample']:<7}{len(r['ingredients']):>4}{s:>9.2f}"
              f"{r['ingredientTotal'][:8]:>10}{len(r['nutrition']):>7}")
