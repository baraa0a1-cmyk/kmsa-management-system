$ErrorActionPreference = 'Stop'

$root = Get-Location
$web = Join-Path $root 'apps\web'
$src = Join-Path $web 'src'
$app = Join-Path $src 'App.tsx'

if (!(Test-Path $app)) {
  throw "لم أجد apps\web\src\App.tsx. افتح PowerShell داخل مجلد مشروع KMSA الرئيسي ثم شغّل السكربت مرة أخرى."
}

Write-Host "KMSA build repair: removing unfinished organization-structure module..." -ForegroundColor Cyan

$sourceFiles = Get-ChildItem -Path $src -Recurse -File -Include *.ts,*.tsx
$hits = @()
foreach ($f in $sourceFiles) {
  if ($f.FullName -match '\\lib\\(api|types)\.ts$') { continue }
  $m = Select-String -Path $f.FullName -Pattern 'OrgStructureSnapshot|organizationStructure|OrgAppointment|OrgBodyType' -Quiet
  if ($m) { $hits += $f }
}

if ($hits.Count -eq 0) {
  Write-Host "لم أجد Module الهيكلة غير المكتمل. قد يكون قد أزيل بالفعل." -ForegroundColor Yellow
} else {
  $appText = Get-Content -Path $app -Raw -Encoding UTF8

  foreach ($f in $hits) {
    $base = [System.IO.Path]::GetFileNameWithoutExtension($f.Name)
    $componentNames = @()

    # Capture default import component names that point to this page.
    $pattern = "import\s+([A-Za-z0-9_]+)\s+from\s+['\"]\./pages/$([regex]::Escape($base))['\"];?"
    foreach ($match in [regex]::Matches($appText, $pattern)) {
      $componentNames += $match.Groups[1].Value
    }

    # Remove the import line itself.
    $appText = [regex]::Replace($appText, "(?m)^.*from\s+['\"]\./pages/$([regex]::Escape($base))['\"];?\s*\r?\n?", '')

    # Remove route lines that use the imported component. KMSA routes are one-line entries.
    foreach ($component in $componentNames) {
      $appText = [regex]::Replace($appText, "(?m)^.*<$([regex]::Escape($component))\s*/>.*\r?\n?", '')
    }

    # Rename the unfinished source so TypeScript no longer compiles it.
    $disabled = $f.FullName + '.disabled'
    if (Test-Path $disabled) { Remove-Item $disabled -Force }
    Move-Item -Path $f.FullName -Destination $disabled -Force
    Write-Host "Disabled: $($f.FullName)" -ForegroundColor Green
  }

  Set-Content -Path $app -Value $appText -Encoding UTF8
}

Write-Host "Running TypeScript/Vite build..." -ForegroundColor Cyan
Push-Location $web
try {
  & npm.cmd run build
  if ($LASTEXITCODE -ne 0) { throw "Build still has errors. Copy the new error output only; the old OrgStructure errors should be gone." }
} finally {
  Pop-Location
}

Write-Host "`nBuild passed. Now commit and push:" -ForegroundColor Green
Write-Host 'git add .'
Write-Host 'git commit -m "Fix unfinished organization structure build"'
Write-Host 'git push'
