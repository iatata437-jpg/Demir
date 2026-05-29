@echo off
setlocal

set APP_HOME=%~dp0
set GRADLE_VERSION=6.7.1
set GRADLE_DIR=%APP_HOME%.gradle-local\gradle-%GRADLE_VERSION%
set GRADLE_ZIP=%APP_HOME%.gradle-local\gradle-%GRADLE_VERSION%-bin.zip
set GRADLE_URL=https://services.gradle.org/distributions/gradle-%GRADLE_VERSION%-bin.zip

if exist "%GRADLE_DIR%\bin\gradle.bat" goto runGradle

if not exist "%APP_HOME%.gradle-local" mkdir "%APP_HOME%.gradle-local"
if not exist "%GRADLE_ZIP%" (
  powershell -NoProfile -ExecutionPolicy Bypass -Command "Invoke-WebRequest -Uri '%GRADLE_URL%' -OutFile '%GRADLE_ZIP%'"
)
powershell -NoProfile -ExecutionPolicy Bypass -Command "Expand-Archive -Force -Path '%GRADLE_ZIP%' -DestinationPath '%APP_HOME%.gradle-local'"

:runGradle
call "%GRADLE_DIR%\bin\gradle.bat" %*
exit /b %ERRORLEVEL%
