@echo off
set "VERSION=3.0.5"
set "URL=https://github.com/Okabe-Rintarou-0/SJTU-Canvas-Helper/releases/download/app-v%VERSION%/SJTU.Canvas.Helper_%VERSION%_x64_en-US.msi"
set "MSI=SJTU.Canvas.Helper_%VERSION%_x64_en-US.msi"

echo ============================================
echo   SJTU Canvas Helper v%VERSION% Installer
echo ============================================
echo.
echo Downloading %MSI% ...
echo.

powershell -Command "Invoke-WebRequest -Uri '%URL%' -OutFile '%MSI%'"

if %ERRORLEVEL% neq 0 (
    echo Download failed! Please check your network connection.
    pause
    exit /b 1
)

echo.
echo Download complete. Installing...
echo.

msiexec /i "%MSI%" /qb

echo.
echo Installation completed successfully!
del "%MSI%"
pause