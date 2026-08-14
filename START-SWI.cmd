@echo off
REM Ponto de entrada do cliente: duplo clique neste arquivo sobe o SWI inteiro.
REM
REM Toda a logica vive em scripts\client\start-swi.ps1. Este arquivo existe
REM porque .ps1 nao executa por duplo clique no Windows (o Explorer abre no
REM editor), enquanto .cmd executa.
REM
REM -ExecutionPolicy Bypass vale SO para este processo: nao altera nenhuma
REM configuracao da maquina e e o que permite rodar o script numa instalacao
REM padrao do Windows, que bloqueia scripts por default.

title SWI - Iniciando

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\client\start-swi.ps1"

REM O pause e essencial: sem ele a janela fecha no instante em que o script
REM termina, e um erro passaria despercebido -- junto com as credenciais de
REM acesso que o script acabou de imprimir.
echo.
pause
