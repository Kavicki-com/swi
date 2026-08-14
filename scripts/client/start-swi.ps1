# Sobe o SWI completo na máquina do cliente.
#
# Quem chama isto é o START-SWI.cmd, por duplo clique. O único pré-requisito é o
# Docker Desktop: não há Node, npm nem Git envolvidos aqui, e é por isso que a
# orquestração é PowerShell (que já vem no Windows) e não um script Node.
#
# Idempotente de ponta a ponta: rodar de novo com a stack de pé reaproveita
# containers e volumes, e o seed é feito de upserts. Nada aqui apaga dado.

$ErrorActionPreference = 'Stop'

# scripts\client\start-swi.ps1 -> sobe dois níveis até a raiz do pacote.
$Raiz = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$Compose = Join-Path $Raiz 'docker-compose.client.yml'
$ArquivoEnv = Join-Path $Raiz 'swi-client.env'

$UrlApi = 'http://localhost:3000/health'
$UrlPainel = 'http://localhost:5173/'

function Escrever-Etapa($texto) { Write-Host "`n==> $texto" -ForegroundColor Cyan }
function Escrever-Ok($texto)    { Write-Host "    OK: $texto" -ForegroundColor Green }
function Escrever-Erro($texto)  { Write-Host "`nERRO: $texto" -ForegroundColor Red }

# Requisição sem passar por proxy.
#
# `Invoke-WebRequest` herda o proxy do sistema, e em máquina corporativa isso faz
# a checagem de localhost sair pela rede da empresa e voltar erro — a stack
# estaria de pé e o script diria que não. Montando o request na mão dá para
# zerar o proxy explicitamente.
function Test-HttpOk($url) {
    try {
        $req = [System.Net.HttpWebRequest]::Create($url)
        $req.Proxy = $null
        $req.Timeout = 3000
        $req.Method = 'GET'
        $resp = $req.GetResponse()
        $codigo = [int]$resp.StatusCode
        $resp.Close()
        return ($codigo -ge 200 -and $codigo -lt 400)
    } catch {
        return $false
    }
}

# A porta está livre para o Docker publicar?
#
# Tentar ABRIR a porta é o único teste honesto: uma listagem de conexões não
# distingue quem consegue de quem não consegue fazer o bind. O Docker publica em
# 127.0.0.1, então é exatamente esse endereço que se testa aqui.
function Test-PortaLivre($porta) {
    $listener = $null
    try {
        $listener = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Loopback, $porta)
        $listener.Start()
        return $true
    } catch {
        return $false
    } finally {
        if ($listener) { try { $listener.Stop() } catch { } }
    }
}

function Esperar-Http($url, $descricao, $segundos) {
    $limite = (Get-Date).AddSeconds($segundos)
    while ((Get-Date) -lt $limite) {
        if (Test-HttpOk $url) { Escrever-Ok "$descricao respondeu."; return }
        Start-Sleep -Seconds 2
        Write-Host '.' -NoNewline
    }
    # Mensagem sem acento de propósito, como todo texto impresso aqui: o console
    # do Windows abre em code page 850, e acento vira caractere trocado bem na
    # hora em que o cliente mais precisa entender o que leu.
    throw "$descricao nao respondeu em $segundos segundos ($url). Para ver o que os containers dizem, rode: docker compose -f `"$Compose`" logs"
}

try {
    Write-Host ''
    Write-Host '  SWI - Sistema de Woman In Mining' -ForegroundColor White
    Write-Host '  Subindo o site e o backend na sua maquina' -ForegroundColor DarkGray
    Write-Host ''

    # ---- 1. Docker Desktop ---------------------------------------------------
    Escrever-Etapa 'Verificando o Docker Desktop'
    try {
        $null = & docker version --format '{{.Server.Version}}' 2>&1
        if ($LASTEXITCODE -ne 0) { throw 'daemon' }
    } catch {
        throw @"
O Docker Desktop nao esta respondendo.

  1. Abra o Docker Desktop pelo menu Iniciar.
  2. Espere o icone da baleia parar de animar (fica "Engine running").
  3. Rode o START-SWI.cmd de novo.

Se o Docker Desktop nao estiver instalado, baixe em:
  https://www.docker.com/products/docker-desktop/
"@
    }
    Escrever-Ok 'Docker Desktop respondendo.'

    # ---- 2. Segredo de assinatura -------------------------------------------
    # Preserva o que já existe: regerar o segredo invalidaria as sessões abertas
    # e, pior, seria uma mudança silenciosa de configuração a cada duplo clique.
    Escrever-Etapa 'Preparando a configuracao local'
    if ((Test-Path $ArquivoEnv) -and (Select-String -Path $ArquivoEnv -Pattern '^JWT_SECRET=.+' -Quiet)) {
        Escrever-Ok 'Configuracao ja existente preservada (swi-client.env).'
    } else {
        $bytes = New-Object 'System.Byte[]' 48
        [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
        # Hexadecimal, e não Base64: o valor entra num arquivo lido pelo Compose,
        # e hex não tem nenhum caractere que precise de escape.
        $segredo = [System.BitConverter]::ToString($bytes).Replace('-', '').ToLower()

        $conteudo = @"
# Gerado automaticamente pelo START-SWI na primeira execucao.
# Vale SO para a stack local desta maquina. Nao versione, nao compartilhe.
JWT_SECRET=$segredo

# Backend que o PAINEL le.
#
# O padrao abaixo e a API que sobe aqui nesta maquina, isolada de tudo. O
# aplicativo Android fala com a API publica, entao NESTE modo os dois nao
# mostram os mesmos dados: sao dois ambientes separados de proposito.
#
# Para o painel ler a mesma API do aplicativo, troque a linha por:
#   VITE_API_URL=https://api.kavicki.com
# e rode o START-SWI de novo. O painel e reconstruido apontando pra la, e passa
# a exibir "api.kavicki.com" ao lado do logo.
VITE_API_URL=http://localhost:3000
"@
        # ASCII de propósito: o Compose lê este arquivo como texto puro, e um BOM
        # de UTF-8 no começo faria a primeira chave virar "?JWT_SECRET", que não
        # casa com nada e some sem explicação.
        Set-Content -Path $ArquivoEnv -Value $conteudo -Encoding ascii
        Escrever-Ok 'Chave de assinatura gerada (swi-client.env).'
    }

    $composeArgs = @('compose', '--env-file', $ArquivoEnv, '-f', $Compose)

    # ---- 3. Portas -----------------------------------------------------------
    # Porta ocupada é a falha mais provável numa máquina de trabalho, e a
    # mensagem que o Docker dá para ela ("Bind for 127.0.0.1:3000 failed: port is
    # already allocated") não diz ao cliente o que fazer. Melhor descobrir antes
    # de baixar imagem e construir nada.
    #
    # A checagem é PULADA quando a nossa própria stack já está de pé: nesse caso
    # as portas estão ocupadas por ela, e reclamar seria impedir o cliente de
    # rodar o START-SWI duas vezes.
    Escrever-Etapa 'Verificando as portas'
    $nossosContainers = (& docker @composeArgs ps -q 2>$null | Where-Object { $_ })
    if ($nossosContainers) {
        Escrever-Ok 'A stack do SWI ja esta de pe; portas dela ignoradas na checagem.'
    } else {
        $ocupadas = @()
        foreach ($p in 5173, 3000, 8025, 9000, 9001) {
            if (-not (Test-PortaLivre $p)) { $ocupadas += $p }
        }
        if ($ocupadas.Count -gt 0) {
            throw @"
Estas portas ja estao em uso nesta maquina: $($ocupadas -join ', ')

O SWI precisa delas para funcionar:
  5173 site        3000 API          8025 caixa de e-mail
  9000 arquivos    9001 painel de arquivos

Feche o programa que esta usando a porta e rode o START-SWI.cmd de novo.
Para descobrir qual programa e, abra o Prompt de Comando e rode:
  netstat -ano | findstr :$($ocupadas[0])
O ultimo numero da linha e o PID, que aparece na aba Detalhes do Gerenciador de Tarefas.
"@
        }
        Escrever-Ok 'Portas livres.'
    }

    # ---- 4. Construir e subir ------------------------------------------------
    Escrever-Etapa 'Construindo e subindo os servicos (a primeira vez demora, baixa imagens)'
    & docker @composeArgs up -d --build
    if ($LASTEXITCODE -ne 0) { throw 'Falha ao subir os servicos. A saida do Docker acima diz o motivo.' }
    Escrever-Ok 'Containers no ar.'

    # ---- 5. API ---------------------------------------------------------------
    # As migrations rodam no boot da própria API (`prisma migrate deploy` antes do
    # `node dist/main`), então /health respondendo já significa banco migrado.
    Escrever-Etapa 'Esperando a API responder (aplica as migracoes do banco no boot)'
    Esperar-Http $UrlApi 'API' 300

    # ---- 6. Seed --------------------------------------------------------------
    Escrever-Etapa 'Carregando os dados de demonstracao'
    & docker @composeArgs run --rm seed
    if ($LASTEXITCODE -ne 0) { throw 'Falha ao carregar os dados de demonstracao.' }
    Escrever-Ok 'Dados de demonstracao carregados.'

    # ---- 7. Painel ------------------------------------------------------------
    Escrever-Etapa 'Esperando o site'
    Esperar-Http $UrlPainel 'Site' 120

    # ---- 8. Navegador ---------------------------------------------------------
    Escrever-Etapa 'Abrindo o navegador'
    Start-Process 'http://localhost:5173'
    Escrever-Ok 'Navegador aberto.'

    Write-Host ''
    Write-Host '  Tudo no ar.' -ForegroundColor Green
    Write-Host ''
    Write-Host '  Site .................. http://localhost:5173'
    Write-Host '  API ................... http://localhost:3000/health'
    Write-Host '  Caixa de e-mail ....... http://localhost:8025'
    Write-Host '  Arquivos (MinIO) ...... http://localhost:9001'
    Write-Host ''
    Write-Host '  Entrar no site:' -ForegroundColor White
    Write-Host '    Administrador ....... admin@swi.local   /  admin123'
    Write-Host '    Trabalhador ......... worker@swi.local  /  worker123'
    Write-Host ''
    Write-Host '  Estas contas existem SO nesta maquina, no banco que o Docker criou' -ForegroundColor DarkGray
    Write-Host '  aqui. Elas nao dao acesso a nada pela internet.' -ForegroundColor DarkGray
    Write-Host ''
    Write-Host '  Os e-mails que o sistema envia (codigo de verificacao de cadastro,' -ForegroundColor DarkGray
    Write-Host '  redefinicao de senha) NAO saem para a internet: eles chegam na caixa' -ForegroundColor DarkGray
    Write-Host '  de entrada de teste em http://localhost:8025.' -ForegroundColor DarkGray
    Write-Host ''
    Write-Host '  Para desligar, use o STOP-SWI.cmd. Seus dados ficam salvos.' -ForegroundColor DarkGray
    Write-Host ''
} catch {
    Escrever-Erro $_.Exception.Message
    Write-Host ''
    exit 1
}
