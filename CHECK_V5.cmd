@echo off
setlocal
cd /d "%~dp0"
echo KMSA v5 - checking required files...
if exist "apps\web\src\pages\WorkspaceStructurePage.tsx" del /q "apps\web\src\pages\WorkspaceStructurePage.tsx"
if exist "supabase\migrations\0010_structure_and_team.sql" (
  if not exist "docs" mkdir "docs"
  move /y "supabase\migrations\0010_structure_and_team.sql" "docs\LEGACY_STRUCTURE_SCHEMA.sql" >nul
)
node scripts\v5-static-check.mjs
if errorlevel 1 goto :fail
cd apps\web
call npm.cmd ci
if errorlevel 1 goto :fail
call npm.cmd run build
if errorlevel 1 goto :fail
cd ..\..
echo.
echo SUCCESS: v5 static tests, TypeScript and Vite build passed.
echo You still need the live Supabase and Drive acceptance tests.
exit /b 0
:fail
echo.
echo FAILED: Do not deploy. Capture the full error output.
exit /b 1
