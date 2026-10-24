$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$app = Join-Path $root 'apps\web\src\App.tsx'

if (-not (Test-Path $app)) {
  throw 'apps\web\src\App.tsx was not found. Put this script in the project root and run it there.'
}

$backup = "$app.build-fix-backup"
Copy-Item $app $backup -Force
Write-Host "Backup created: $backup"

$tempJs = Join-Path $env:TEMP 'kmsa-build-fix.cjs'

$js = @'
const fs = require("fs");
const path = require("path");

const root = process.argv[2];
const app = path.join(root, "apps", "web", "src", "App.tsx");
const pagesDir = path.join(root, "apps", "web", "src", "pages");

let text = fs.readFileSync(app, "utf8");
let lines = text.split(/\r?\n/);

const importRe = /^\s*import\s+([A-Za-z0-9_]+)\s+from\s+["']\.\/pages\/([^"']+)["'];?\s*$/;
const missing = [];

for (let i = 0; i < lines.length; i++) {
  const m = lines[i].match(importRe);
  if (!m) continue;

  const component = m[1];
  const rel = m[2];
  const candidates = [
    path.join(pagesDir, rel + ".tsx"),
    path.join(pagesDir, rel + ".ts"),
    path.join(pagesDir, rel + ".jsx"),
    path.join(pagesDir, rel + ".js"),
    path.join(pagesDir, rel, "index.tsx"),
    path.join(pagesDir, rel, "index.ts"),
    path.join(pagesDir, rel, "index.jsx"),
    path.join(pagesDir, rel, "index.js"),
  ];

  if (!candidates.some(fs.existsSync)) {
    missing.push({ component, importLine: i, rel });
  }
}

if (missing.length === 0) {
  console.log("No missing page imports were found in App.tsx.");
  process.exit(0);
}

console.log("Removing unfinished page references:");
for (const item of missing) {
  console.log(` - ${item.component} -> ./pages/${item.rel}`);
}

const missingNames = new Set(missing.map(x => x.component));

lines = lines.filter((line, index) => {
  if (missing.some(x => x.importLine === index)) return false;

  for (const name of missingNames) {
    if (line.includes(`<${name}`)) return false;
  }
  return true;
});

fs.writeFileSync(app, lines.join("\n"), "utf8");
console.log("App.tsx updated using UTF-8.");
'@

Set-Content -Path $tempJs -Value $js -Encoding ASCII

try {
  & node $tempJs $root
  if ($LASTEXITCODE -ne 0) {
    throw "Node fix step failed with exit code $LASTEXITCODE"
  }
}
finally {
  Remove-Item $tempJs -Force -ErrorAction SilentlyContinue
}

$web = Join-Path $root 'apps\web'
Push-Location $web
try {
  Write-Host ""
  Write-Host "Running local build..."
  & npm.cmd run build
  if ($LASTEXITCODE -ne 0) {
    throw "Build failed with exit code $LASTEXITCODE. Copy the build error and send it to ChatGPT."
  }
}
finally {
  Pop-Location
}

Write-Host ""
Write-Host "BUILD PASSED."
Write-Host "Review git diff, then run:"
Write-Host "  git add ."
Write-Host '  git commit -m "Fix unfinished organization structure build"'
Write-Host "  git push"
