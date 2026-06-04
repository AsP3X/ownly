@echo off
setlocal enabledelayedexpansion

rem Install Python dependencies from scripts\requirements.txt into scripts\.venv
rem
rem Prerequisite: virtualenv at scripts\.venv (create with setup-test-env.bat)
rem
rem Usage:
rem   scripts\install-requirements.bat
rem
rem Optional: pass --create-venv to create the venv if missing

set "SCRIPT_DIR=%~dp0"
set "VENV_DIR=%SCRIPT_DIR%.venv"
set "REQ_FILE=%SCRIPT_DIR%requirements.txt"
set "CREATE_VENV=0"

if /I "%~1"=="--create-venv" set "CREATE_VENV=1"
if /I "%~1"=="-h" goto :usage
if /I "%~1"=="--help" goto :usage

if not exist "%REQ_FILE%" (
    echo Error: requirements file not found: %REQ_FILE%
    exit /b 1
)

if not exist "%VENV_DIR%\Scripts\python.exe" (
    if "%CREATE_VENV%"=="1" (
        set "PYTHON=py"
        where !PYTHON! >nul 2>&1
        if errorlevel 1 (
            set "PYTHON=python"
            where !PYTHON! >nul 2>&1
            if errorlevel 1 (
                echo Error: Could not find "py" or "python" in PATH.
                exit /b 1
            )
        )
        echo ==^> Creating virtual environment at %VENV_DIR%
        !PYTHON! -m venv "%VENV_DIR%"
        if errorlevel 1 exit /b 1
    ) else (
        echo Error: no virtualenv at %VENV_DIR%
        echo Run: scripts\setup-test-env.bat
        echo Or: scripts\install-requirements.bat --create-venv
        exit /b 1
    )
)

echo ==^> Activating venv
call "%VENV_DIR%\Scripts\activate.bat"

echo ==^> Upgrading pip, wheel, setuptools...
python -m pip install --upgrade pip wheel setuptools

echo ==^> Installing from %REQ_FILE% ...
python -m pip install -r "%REQ_FILE%"
if errorlevel 1 exit /b 1

echo.
echo ==^> Done. Dependencies installed in: %VENV_DIR%
echo Activate with: %VENV_DIR%\Scripts\activate.bat
goto :eof

:usage
echo Usage: scripts\install-requirements.bat [--create-venv]
echo   Installs scripts\requirements.txt into scripts\.venv
exit /b 0
