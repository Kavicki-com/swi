@echo off
REM Desliga o SWI. Duplo clique.
REM
REM Para os containers e preserva os dados: nada aqui apaga banco, arquivo
REM enviado ou cadastro. Ver scripts\client\stop-swi.ps1.

title SWI - Desligando

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\client\stop-swi.ps1"

echo.
pause
