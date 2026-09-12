@echo off
rem kibborg — launcher shim. Prefers the built application; falls back to the
rem source entry through tsx when the checkout has not been built yet.
setlocal
set "KIBBORG_REPO=%~dp0..\.."
set "KIBBORG_APP=%KIBBORG_REPO%\Kibborg_CLI\apps\cli"
if exist "%KIBBORG_APP%\lib\bin.js" (
  node "%KIBBORG_APP%\lib\bin.js" %*
) else (
  pnpm --dir "%KIBBORG_REPO%" exec tsx "%KIBBORG_APP%\src\bin.ts" %*
)
exit /b %ERRORLEVEL%
