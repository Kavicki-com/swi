# Desliga a stack local do SWI.
#
# Para os containers e SÓ isso. Nenhum `-v`, nenhum `--rmi`, nenhum `prune`: os
# volumes com o banco e os arquivos enviados sobrevivem, e o próximo START-SWI
# encontra tudo como estava. Um reset destrutivo não faz parte do fluxo normal e
# não vai num script que o cliente aciona por duplo clique.

$ErrorActionPreference = 'Stop'

$Raiz = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$Compose = Join-Path $Raiz 'docker-compose.client.yml'
$ArquivoEnv = Join-Path $Raiz 'swi-client.env'

try {
    Write-Host ''
    Write-Host '  Desligando o SWI' -ForegroundColor White
    Write-Host ''

    try {
        $null = & docker version --format '{{.Server.Version}}' 2>&1
        if ($LASTEXITCODE -ne 0) { throw 'daemon' }
    } catch {
        throw @"
O Docker Desktop nao esta respondendo, entao nao ha o que desligar.
Se os containers ainda aparecerem no Docker Desktop, abra-o e rode este arquivo de novo.
"@
    }

    $composeArgs = @('compose')
    # O Compose interpola o arquivo inteiro antes de qualquer ação, inclusive no
    # `down`, e o JWT_SECRET é declarado como obrigatório. Sem passar o env-file
    # aqui, desligar falharia na interpolação — mas o arquivo pode não existir se
    # o cliente nunca chegou a rodar o START, e aí o `down` ainda precisa
    # funcionar para limpar containers de uma tentativa interrompida.
    if (Test-Path $ArquivoEnv) {
        $composeArgs += @('--env-file', $ArquivoEnv)
    } else {
        $env:JWT_SECRET = 'apenas-para-interpolar-o-arquivo-no-down'
    }
    $composeArgs += @('-f', $Compose)

    & docker @composeArgs down
    if ($LASTEXITCODE -ne 0) { throw 'Falha ao desligar. A saida do Docker acima diz o motivo.' }

    Write-Host ''
    Write-Host '  Desligado.' -ForegroundColor Green
    Write-Host ''
    Write-Host '  Seus dados continuam salvos: cadastros, mensagens e arquivos' -ForegroundColor DarkGray
    Write-Host '  enviados reaparecem no proximo START-SWI.cmd.' -ForegroundColor DarkGray
    Write-Host ''
} catch {
    Write-Host "`nERRO: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host ''
    exit 1
}
