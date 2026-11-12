<#
.SYNOPSIS
  manifest.json 기준으로 다운로드된 라벨 PDF 를 리네임·이동한다. (MD 6-1 / 7-1 / 7-2 대응)

.DESCRIPTION
  MD 문서의 사고 2건을 구조적으로 막는다.

    7-1  대괄호 와일드카드 → 모든 파일 조작에 -LiteralPath 를 쓴다.
         라벨명에 [전지분유22% 함유] 같은 대괄호가 들어가면 -LiteralPath 없는
         Copy/Move/Remove/Test-Path 는 에러 없이 조용히 실패한다.

    7-2  순서 한 칸 밀림 → index 매핑을 쓰지 않는다. manifest.json 의
         downloadName(라벨명 + Chrome 의 " (n)" 접미사) 으로 명시 매칭하고,
         스테이징 폴더가 비어 있지 않으면 실행을 거부한다.
         또 하나라도 어긋나면 "아무 파일도 건드리지 않고" 중단한다 (all-or-nothing).

.PARAMETER Staging
  PDF 를 받은 전용 빈 폴더. manifest.json 도 여기 둔다.

.PARAMETER Manifest
  브라우저에서 LE.manifest() 로 받은 manifest.json 경로.

.PARAMETER Dest
  최종 이동 위치. 예: 'G:\공유 드라이브\...\Cont No 17\Label'. 생략하면 리네임만.

.PARAMETER Apply
  지정하지 않으면 dry-run (아무것도 바꾸지 않음).

.EXAMPLE
  .\rename_move.ps1 -Staging 'C:\Users\krogu\Downloads\_label_stage' -Manifest 'C:\Users\krogu\Downloads\_label_stage\manifest.json'
  .\rename_move.ps1 -Staging 'C:\...\_label_stage' -Manifest 'C:\...\manifest.json' -Dest 'G:\...\Cont No 17\Label' -Apply
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory)][string]$Staging,
  [Parameter(Mandatory)][string]$Manifest,
  [string]$Dest,
  [switch]$Apply
)

$ErrorActionPreference = 'Stop'
function Say  ([string]$m) { Write-Host $m }
function Warn ([string]$m) { Write-Host "  경고  $m" -ForegroundColor Yellow }
function Bad  ([string]$m) { Write-Host "  오류  $m" -ForegroundColor Red }

if (-not (Test-Path -LiteralPath $Staging))  { throw "스테이징 폴더 없음: $Staging" }
if (-not (Test-Path -LiteralPath $Manifest)) { throw "manifest 없음: $Manifest" }

$man = Get-Content -LiteralPath $Manifest -Raw -Encoding UTF8 | ConvertFrom-Json
$entries = @($man.clickOrder)
Say ""
Say "manifest : $($man.folder.name)  ($($man.folder.id))"
Say "제조일   : $($man.mfgDate)"
Say "기대 건수: $($man.expectedCount)"
Say "모드     : $(if ($Apply) { '적용' } else { 'DRY-RUN (아무것도 바꾸지 않음)' })"
Say ""

# ---- 1) 스테이징 폴더 내용 점검 -------------------------------------------
$pdfs = @(Get-ChildItem -LiteralPath $Staging -Filter *.pdf -File)
Say "[1/6] 스테이징 PDF $($pdfs.Count)개 / 기대 $($entries.Count)개"

$problems = @()
if ($pdfs.Count -ne $entries.Count) {
  $problems += "PDF 개수 불일치 ($($pdfs.Count) ≠ $($entries.Count)). 스테이징 폴더는 이번 차수 PDF 만 들어 있어야 합니다."
}

# ---- 2) manifest 와 실제 파일 명시 매칭 (index 매핑 금지) -------------------
Say "[2/6] manifest ↔ 실제 파일 명시 매칭"
$plan = @()
foreach ($e in $entries) {
  $srcPath = Join-Path $Staging $e.downloadName
  $exists  = Test-Path -LiteralPath $srcPath -PathType Leaf
  if (-not $exists) { $problems += "없음: [$($e.seq)] $($e.downloadName)" }
  $plan += [pscustomobject]@{
    Seq = $e.seq; Source = $srcPath; DownloadName = $e.downloadName
    TargetName = $e.targetName; Name = $e.name; SizeTag = $e.sizeTag
    NetWeight = $e.netWeight; MfgDate = $e.mfgDate; BestBy = $e.bestByDate
    Exists = $exists
  }
}
$matched = @($plan | Where-Object Exists).Count
Say "      매칭 $matched / $($entries.Count)"

# manifest 에 없는 여분 파일
$expectedNames = $entries.downloadName
$extra = @($pdfs | Where-Object { $expectedNames -notcontains $_.Name })
if ($extra.Count) {
  $problems += "manifest 에 없는 파일 $($extra.Count)개 — 이전 차수 잔존 파일일 수 있습니다 (MD 7-2 의 원인)."
  $extra | ForEach-Object { Bad "여분: $($_.Name)" }
}

# ---- 3) 0바이트 / 중복 해시 점검 -------------------------------------------
Say "[3/6] 0바이트 및 MD5 중복 점검"
$zero = @($pdfs | Where-Object { $_.Length -eq 0 })
if ($zero.Count) { $problems += "0바이트 파일 $($zero.Count)개"; $zero | ForEach-Object { Bad "0바이트: $($_.Name)" } }

$hashes = $pdfs | ForEach-Object { Get-FileHash -LiteralPath $_.FullName -Algorithm MD5 }
$dups = $hashes | Group-Object Hash | Where-Object Count -gt 1
if ($dups) {
  $problems += "MD5 중복 $($dups.Count)그룹 — 같은 내용이 다른 이름으로 저장됐습니다 (MD 7-2 의 증상)."
  foreach ($g in $dups) {
    Bad "중복 해시 $($g.Name.Substring(0,8))"
    $g.Group | ForEach-Object { Bad "   $(Split-Path -Leaf $_.Path)" }
  }
}

# ---- 4) 최종 파일명 충돌 점검 ----------------------------------------------
Say "[4/6] 최종 파일명 충돌 점검"
$tdups = $plan.TargetName | Group-Object | Where-Object Count -gt 1
if ($tdups) { $problems += "최종 파일명 중복: $($tdups.Name -join ', ') — manifest 의 sizeTag 를 지정하세요." }
if ($Dest -and (Test-Path -LiteralPath $Dest)) {
  foreach ($p in $plan) {
    if (Test-Path -LiteralPath (Join-Path $Dest $p.TargetName)) { Warn "대상에 이미 있음: $($p.TargetName)" }
  }
}

# ---- 5) 계획 출력 / 게이트 --------------------------------------------------
Say ""
$plan | Format-Table Seq, DownloadName, TargetName, NetWeight, MfgDate, BestBy -AutoSize
Say ""

if ($problems.Count) {
  Say "[5/6] 중단 — 문제 $($problems.Count)건. 파일을 하나도 건드리지 않았습니다." 
  $problems | ForEach-Object { Bad $_ }
  Say ""
  Say "권장 조치:"
  Say "  1) 스테이징 폴더를 비우고 라벨에디터에서 4건 이하씩 다시 받으세요."
  Say "  2) Chrome 다운로드 폴더를 스테이징 폴더로 바꿔두면 Downloads 잔존 파일에 밀리지 않습니다."
  throw "사전 점검 실패 — 중단"
}
Say "[5/6] 사전 점검 전부 통과"

if (-not $Apply) {
  Say ""
  Say "DRY-RUN 종료. 실제로 적용하려면 -Apply 를 붙여 다시 실행하세요."
  return
}

# ---- 6) 리네임 → 이동 (전부 -LiteralPath) ----------------------------------
Say "[6/6] 리네임 및 이동"
if ($Dest -and -not (Test-Path -LiteralPath $Dest)) {
  New-Item -ItemType Directory -Path $Dest -Force | Out-Null
  Say "      대상 폴더 생성: $Dest"
}

$done = @()
foreach ($p in $plan) {
  $renamed = Join-Path $Staging $p.TargetName
  if ($p.DownloadName -ne $p.TargetName) {
    Rename-Item -LiteralPath $p.Source -NewName $p.TargetName        # ← -LiteralPath (MD 7-1)
  }
  if (-not (Test-Path -LiteralPath $renamed)) { throw "리네임 실패: $($p.TargetName) — 중단 (처리분 $($done.Count)건)" }

  if ($Dest) {
    Move-Item -LiteralPath $renamed -Destination (Join-Path $Dest $p.TargetName) -Force   # ← -LiteralPath
    $final = Join-Path $Dest $p.TargetName
  } else { $final = $renamed }

  if (-not (Test-Path -LiteralPath $final)) { throw "이동 실패: $($p.TargetName) — 중단" }
  $done += $final
  Say "      [$($p.Seq)] $($p.TargetName)"
}

# ---- 사후 전수 검증 --------------------------------------------------------
Say ""
Say "사후 검증"
$finalHashes = $done | ForEach-Object { Get-FileHash -LiteralPath $_ -Algorithm MD5 }
$fdup = $finalHashes | Group-Object Hash | Where-Object Count -gt 1
$fzero = @($done | Where-Object { (Get-Item -LiteralPath $_).Length -eq 0 })

Say "      파일 $($done.Count)개"
Say "      MD5 중복 : $(if ($fdup) { "$($fdup.Count)그룹 ← 확인 필요" } else { '0건' })"
Say "      0바이트  : $($fzero.Count)건"
if ($fdup -or $fzero.Count) { Bad "검증 실패 — 내용을 확인하세요."; exit 1 }

Say ""
Say "완료. 다음: python verify_pdf.py --dir `"$(if ($Dest) { $Dest } else { $Staging })`" --manifest `"$Manifest`""
