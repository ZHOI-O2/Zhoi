# -*- coding: utf-8 -*-
"""영문 원재료 → 한글 표기 초안 + 합산/내림차순 재정렬. 담당자 검토 필요."""
import re, collections

KOR = {
 'cocoa butter':'코코아버터', 'cocoa mass':'코코아매스', 'sugar':'설탕',
 'whole milk powder(milk fat 30%)':'전지분유', 'whole milk powder':'전지분유',
 'whole milk power':'전지분유',                      # 원본 오타(Power) 보정
 'lecithin(emulsifier)':'레시틴(유화제)', 'lecithin (emulsifier)':'레시틴(유화제)',
 'pgpr(glycerin esters of fatty acids':'PGPR(유화제)',   # 원본 괄호 미닫힘 보정
 'pgpr(glycerin esters of fatty acids)':'PGPR(유화제)',
 'pgpr (glycerin esters of fatty acids)':'PGPR(유화제)',
 'natural flavor (vanilla)':'천연향료(바닐라)', 'synthetic flavor':'합성향료',
 'fd blueberry powder':'동결건조블루베리분말', 'fd strawberry':'동결건조딸기',
 'fd yogurt':'동결건조요거트분말', 'green tea powder':'녹차분말',
 'dried orange skin':'건조오렌지껍질', 'corn flakes':'콘플레이크',
 'lemon powder':'레몬분말', 'black pepper':'흑후추',
 'sea salt':'천일염', 'cocoa nips':'카카오닙스',
 'roasted macadamia':'볶은마카다미아', 'roasted peanuts':'볶은땅콩',
 'roasted almond':'볶은아몬드',
}
ALLERGEN = {'전지분유':'우유', '레시틴(유화제)':'대두', '동결건조요거트분말':'우유',
            '볶은땅콩':'땅콩', '볶은아몬드':'아몬드', '볶은마카다미아':'마카다미아',
            '콘플레이크':'밀'}   # 콘플레이크 맥아엑기스 유래 — 제조사 확인 필요

def ko(name):
    k = re.sub(r'\s+', ' ', name.strip()).lower()
    if k not in KOR: raise KeyError(f'한글명 미정의: {name!r}')
    return KOR[k]

def merged(ingredients):
    """같은 원재료를 합산하고 배합비 내림차순으로 정렬."""
    agg = collections.OrderedDict()
    for i in ingredients:
        if not i['pct']: continue
        agg[ko(i['name'])] = agg.get(ko(i['name']), 0) + float(i['pct'])
    return sorted(agg.items(), key=lambda kv: -kv[1])

def label_text(ingredients):
    return ', '.join(f'{n} {p:.4g}%' for n, p in merged(ingredients))

def allergens(ingredients):
    return sorted({ALLERGEN[ko(i['name'])] for i in ingredients if ko(i['name']) in ALLERGEN})
