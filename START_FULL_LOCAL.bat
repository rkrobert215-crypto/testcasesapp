@echo off
setlocal

cd /d "%~dp0"

echo.
echo ==========================================
echo Starting full local Supabase environment...
echo ==========================================
echo.

call npm.cmd run supabase:start
if errorlevel 1 (
  echo.
  echo Failed to start local Supabase.
  echo Make sure Docker Desktop is open and fully running.
  pause
  exit /b 1
)

set "API_URL="
set "ANON_KEY="

for /f "usebackq delims=" %%L in (`npm.cmd run supabase:status 2^>nul`) do (
  echo %%L | findstr /R "^[A-Z_][A-Z_]*=" >nul && call set "%%L"
)

if not defined API_URL (
  echo.
  echo Could not read API_URL from local Supabase status.
  echo Run "npm.cmd run supabase:status" manually and check the output.
  pause
  exit /b 1
)

if not defined ANON_KEY (
  echo.
  echo Could not read ANON_KEY from local Supabase status.
  echo Run "npm.cmd run supabase:status" manually and check the output.
  pause
  exit /b 1
)

(
  echo VITE_SUPABASE_URL=%API_URL%
  echo VITE_SUPABASE_PUBLISHABLE_KEY=%ANON_KEY%
  echo VITE_LOCAL_AI_SERVER_URL=http://127.0.0.1:8787
) > ".env.local"

if not exist "supabase\functions\.env.local" (
  copy /Y "supabase\functions\.env.local.example" "supabase\functions\.env.local" >nul
)

echo.
echo Created .env.local with your local Supabase values.
echo.
echo Starting local Generate server in a new window...
start "Local AI Server" cmd /k "cd /d ""%~dp0"" && npm.cmd run server:generate"

echo Starting local Edge Functions in a new window...
start "Supabase Functions" cmd /k "cd /d ""%~dp0"" && npm.cmd run supabase:functions:serve"

echo Starting frontend in a new window...
start "Vite Frontend" cmd /k "cd /d ""%~dp0"" && npm.cmd run dev -- --host 127.0.0.1 --port 5173"

echo.
echo ==========================================
echo Full local environment is starting.
echo Open: http://localhost:5173
echo ==========================================
echo.
pause
