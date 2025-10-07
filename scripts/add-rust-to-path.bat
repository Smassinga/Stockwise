@echo off
echo Adding Rust to PATH...

REM Add Rust to the current session PATH
set PATH=%USERPROFILE%\.cargo\bin;%PATH%

REM Try to verify Rust is now accessible
rustc --version >nul 2>&1
if %errorlevel% == 0 (
    echo Rust is now accessible in this session!
    echo You can now run the Tauri setup script:
    echo node scripts/setup-tauri.mjs
) else (
    echo Failed to make Rust accessible.
    echo Please manually add the following to your system PATH:
    echo %USERPROFILE%\.cargo\bin
    echo Then restart your terminal/command prompt.
)

pause