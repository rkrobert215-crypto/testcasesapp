@echo off
setlocal

cd /d "%~dp0"

echo.
echo ==================================================
echo This will update your HOSTED Supabase backend live.
echo ==================================================
echo.

echo Step 1: Supabase login
npx.cmd supabase login
if errorlevel 1 (
  echo.
  echo Supabase login did not finish.
  pause
  exit /b 1
)

echo.
echo Step 2: Link local repo to hosted project
npx.cmd supabase link --project-ref cbaorohwkyjswuvjgxlf
if errorlevel 1 (
  echo.
  echo Supabase link did not finish.
  pause
  exit /b 1
)

echo.
echo Step 3: Deploying edge functions
npx.cmd supabase functions deploy generate-test-cases --no-verify-jwt
if errorlevel 1 goto :deploy_error
npx.cmd supabase functions deploy audit-test-cases --no-verify-jwt
if errorlevel 1 goto :deploy_error
npx.cmd supabase functions deploy smart-merge-testcases --no-verify-jwt
if errorlevel 1 goto :deploy_error
npx.cmd supabase functions deploy validate-coverage --no-verify-jwt
if errorlevel 1 goto :deploy_error
npx.cmd supabase functions deploy requirement-analysis --no-verify-jwt
if errorlevel 1 goto :deploy_error

echo.
echo ==================================================
echo Hosted Supabase backend deployment finished.
echo ==================================================
echo.
pause
exit /b 0

:deploy_error
echo.
echo Deployment stopped because one of the function deploy commands failed.
pause
exit /b 1
