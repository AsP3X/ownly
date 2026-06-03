@echo off
setlocal enabledelayedexpansion

rem Creates a Python virtual environment for the testing / audit scripts
rem (security-audit and storage-audit) and installs required dependencies.
rem
rem For Windows (cmd.exe / PowerShell).
rem
rem Usage:
rem   scripts\setup-test-env.bat
rem
rem After running, in the same cmd session the script will activate the venv
rem for subsequent commands in the same window, or run:
rem   scripts\.venv\Scripts\activate.bat
rem
rem The security-audit scripts require no third-party packages (stdlib only).
rem storage-audit.py pulls in psycopg[binary].

echo ==^> Creating virtual environment for audit / test scripts

set "SCRIPT_DIR=%~dp0"
set "VENV_DIR=%SCRIPT_DIR%.venv"
set "REQ_FILE=%SCRIPT_DIR%requirements.txt"

rem Try "py" launcher first (recommended on Windows), then plain python.
set "PYTHON=py"
where %PYTHON% >nul 2>&1
if errorlevel 1 (
    set "PYTHON=python"
    where %PYTHON% >nul 2>&1
    if errorlevel 1 (
        echo Error: Could not find "py" or "python" in PATH.
        echo Install Python from https://www.python.org/ or Microsoft Store.
        exit /b 1
    )
)

echo Using %PYTHON% to create venv...
%PYTHON% -m venv "%VENV_DIR%"
if errorlevel 1 (
    echo Failed to create venv.
    exit /b 1
)

echo ==^> Activating venv for this session...
call "%VENV_DIR%\Scripts\activate.bat"

echo ==^> Upgrading pip, wheel, setuptools...
python -m pip install --upgrade pip wheel setuptools

if exist "%REQ_FILE%" (
    echo ==^> Installing dependencies from %REQ_FILE% ...
    python -m pip install -r "%REQ_FILE%"
) else (
    echo Warning: %REQ_FILE% not found; skipping dependency install.
)

echo.
echo ==^> Done. Virtual environment created at: %VENV_DIR%
echo.
echo To activate in a new Command Prompt:
echo   %VENV_DIR%\Scripts\activate.bat
echo.
echo To activate in PowerShell:
echo   %VENV_DIR%\Scripts\Activate.ps1
echo.
echo Example runs (venv must be active):
echo   python -m unittest discover -s scripts\security-audit\tests -v
echo   python scripts\security-audit\sec001_setup_info_disclosure.py --help
echo   python scripts\storage-audit.py
echo.
echo   # Makefile targets auto-detect ..\.venv when present:
echo   make -C scripts\security-audit test
echo   make -C scripts\security-audit sec001
echo.
endlocal
