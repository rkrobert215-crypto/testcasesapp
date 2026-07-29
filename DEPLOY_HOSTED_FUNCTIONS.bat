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
if not defined SUPABASE_PROJECT_REF set /p "SUPABASE_PROJECT_REF=Enter the Supabase project ref: "
if not defined SUPABASE_PROJECT_REF (
  echo.
  echo Supabase project ref is required. Nothing was deployed.
  pause
  exit /b 1
)
npx.cmd supabase link --project-ref "%SUPABASE_PROJECT_REF%"
if errorlevel 1 (
  echo.
  echo Supabase link did not finish.
  pause
  exit /b 1
)

echo.
echo Step 3: Deploying edge functions
rem Keep this list in sync with the local server routes and QA planning tabs.
set "FUNCTIONS=generate-test-cases audit-test-cases smart-merge-testcases validate-coverage requirement-analysis test-plan traceability-matrix test-data-plan scenario-map clarification-questions"
for %%F in (%FUNCTIONS%) do (
  echo Deploying %%F...
  npx.cmd supabase functions deploy %%F --no-verify-jwt
  if errorlevel 1 goto :deploy_error
)

echo.
echo ==================================================
echo Hosted Supabase backend deployment finished for %SUPABASE_PROJECT_REF%.
echo ==================================================
echo.
pause
exit /b 0

:deploy_error
echo.
echo Deployment stopped because one of the function deploy commands failed.
pause
exit /b 1
