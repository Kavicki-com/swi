# Se algo der errado

Problemas em ordem de probabilidade. Cada um traz o sintoma exato, a causa e o
que fazer.

---

## O site

### "O Docker Desktop nao esta respondendo"

**Sintoma.** A janela preta do `START-SWI.cmd` mostra essa mensagem e para logo
no começo, sem baixar nada.

**Causa.** O Docker Desktop está fechado, ainda está iniciando, ou travou.

**O que fazer.**

1. Abra o Docker Desktop pelo menu Iniciar.
2. Espere o ícone da baleia parar de animar. No canto inferior deve aparecer
   **"Engine running"**.
3. Rode o `START-SWI.cmd` de novo.

Se ele ficar minutos em "Starting" e não sair disso, reinicie o computador e abra
o Docker Desktop antes de qualquer outra coisa. Se nem assim, use
**Troubleshoot > Restart** dentro do próprio Docker Desktop.

---

### "Estas portas ja estao em uso nesta maquina"

**Sintoma.** A janela preta lista uma ou mais portas e para **antes** de
construir qualquer coisa.

**Causa.** Outro programa já ocupa a porta que o SWI precisa. Os candidatos
comuns: outro projeto de desenvolvimento rodando, um PostgreSQL instalado na
máquina, ou uma execução anterior do próprio SWI que ficou pela metade.

**O que fazer.**

1. Feche o programa que está usando a porta e rode o `START-SWI.cmd` de novo.
2. Para descobrir qual programa é, abra o Prompt de Comando e rode, trocando
   `3000` pela porta que apareceu na mensagem:

   ```
   netstat -ano | findstr :3000
   ```

   O último número da linha é o **PID**. Ele aparece na aba **Detalhes** do
   Gerenciador de Tarefas (Ctrl+Shift+Esc), na coluna PID, e ali dá para ver de
   qual programa se trata.

3. Se a porta ocupada for o próprio SWI de uma tentativa anterior, rode o
   `STOP-SWI.cmd` e depois o `START-SWI.cmd`.

As cinco portas usadas:

| Porta | Para quê |
| --- | --- |
| 5173 | o site |
| 3000 | a API |
| 8025 | a caixa de e-mail de teste |
| 9000 | os arquivos enviados |
| 9001 | o painel dos arquivos |

---

### Aparece "SecretsUsedInArgOrEnv" durante a construção

**Sintoma.** No meio do build, o Docker imprime algo como:

```
1 warning found (use docker --debug to expand):
 - SecretsUsedInArgOrEnv: Do not use ARG or ENV instructions for sensitive data
   (ENV "VITE_MAPBOX_TOKEN") (line 41)
```

**Isso não é um erro e não quebra nada.** O `START-SWI.cmd` continua normalmente.

**Causa.** O Docker tem um verificador automático que suspeita de qualquer
variável com a palavra `TOKEN` no nome e avisa por precaução.

**Por que é falso positivo aqui.** Toda variável que começa com `VITE_` é
compilada **dentro do arquivo JavaScript que o navegador baixa**. Ou seja, nada
que passe por ali poderia ser secreto, por definição da tecnologia. A variável em
questão é o token de mapa, que é do tipo público e é protegido por restrição de
origem, não por sigilo. Além disso, nesta instalação ela vai **vazia**: o mapa
funciona sem token nenhum, usando imagens de satélite abertas.

**O que fazer.** Nada. O aviso está explicado dentro do próprio
`swi-admin/Dockerfile`.

---

### A construção falha por falta de espaço

**Sintoma.** Erros com `no space left on device` durante o build.

**Causa.** Disco cheio, ou o Docker Desktop atingiu o limite de espaço dele.

**O que fazer.** Libere espaço no disco e, no Docker Desktop, vá em
**Settings > Resources > Advanced** e use a limpeza de dados de build. A próxima
construção baixa o que foi removido, mas **os seus dados do SWI não são
apagados** por essa limpeza.

---

### A janela preta fechou sozinha e eu não li o erro

O `START-SWI.cmd` foi feito para **não** fechar sozinho: ele para e espera uma
tecla no final, justamente para o erro poder ser lido. Se ainda assim você perdeu
a mensagem, abra o Prompt de Comando, entre na pasta do SWI e rode:

```
.\START-SWI.cmd
```

A saída fica na tela. O `.\` na frente não é enfeite: em algumas configurações do
Windows, sem ele o Prompt de Comando responde que não reconhece o arquivo, mesmo
com ele ali na pasta.

---

### O navegador abriu, mas a página não carrega

**Causa provável.** O site subiu, mas você chegou nele antes de terminar.

**O que fazer.** Espere alguns segundos e recarregue com **Ctrl+F5**. Se
continuar, confirme se a API está de pé abrindo
<http://localhost:3000/health>. Ela deve responder:

```json
{"status":"ok"}
```

Se a API responde e o site não, rode o `STOP-SWI.cmd` seguido do
`START-SWI.cmd`.

---

### O site abre mas nada carrega, ou dá erro ao entrar

**Causa provável.** A API não está respondendo.

**O que fazer.** Confirme em <http://localhost:3000/health>. Se ela não responder,
veja o que os containers estão dizendo. Abra o Prompt de Comando na pasta do SWI
e rode:

```
docker compose -f docker-compose.client.yml --env-file swi-client.env logs api
```

Troque `api` por `db`, `minio` ou `admin` para ver os outros.

---

### Não consigo entrar com `admin@swi.local`

Confira, nesta ordem:

1. **A senha é `admin123`**, tudo minúsculo, sem espaço no fim. Cuidado com o
   preenchimento automático do navegador.
2. **Você está no site local** (`http://localhost:5173`) e não em outro endereço.
   Essa conta não existe em nenhum outro lugar.
3. **Os dados de demonstração carregaram.** Se o `START-SWI.cmd` falhou na etapa
   "Carregando os dados de demonstracao", o banco pode estar vazio. Rode o
   `START-SWI.cmd` de novo: o carregamento é repetível e não duplica nada.

---

### Um cadastro novo não consegue entrar

Isso é **comportamento esperado**, não defeito. O sistema tem duas travas na
entrada de usuário novo:

1. **Verificação de e-mail.** Depois de se cadastrar, é preciso confirmar um
   código. Nesta instalação local, o e-mail com o código **não sai para a
   internet**: ele chega em <http://localhost:8025>. Abra, clique na mensagem e
   leia o código.
2. **Aprovação pelo administrador.** Mesmo com o e-mail confirmado, o usuário fica
   pendente até um administrador aprová-lo. Entre como `admin@swi.local`, vá em
   **Funcionários**, abra a aba **Pendentes** e clique em **Aprovar**.

---

### O e-mail com o código não chegou

Ele não vai chegar na sua caixa de verdade, e isso é proposital. **Nesta
instalação, nenhum e-mail sai para a internet.** Todos param em
<http://localhost:8025>.

Se a mensagem também não estiver lá, veja os registros do serviço de e-mail:

```
docker compose -f docker-compose.client.yml --env-file swi-client.env logs mailhog
```

---

### Não consigo anexar foto em relatório ou no chat

**Causa provável.** O serviço de arquivos (porta 9000) não está no ar.

**O que fazer.** Abra <http://localhost:9001>. Se o painel de arquivos não
carregar, o serviço está fora. Rode o `STOP-SWI.cmd` e depois o `START-SWI.cmd`.

Vale conferir se algum antivírus ou firewall corporativo está bloqueando conexões
para `localhost`. Elas não saem da máquina, mas há ferramentas que as interceptam
mesmo assim.

---

### O mapa aparece sem imagem de satélite

O mapa usa imagens abertas, sem chave de acesso, e depende de internet para
buscá-las. Sem conexão, os controles e os marcadores aparecem, mas o fundo fica
vazio. É a única parte do site local que precisa de internet depois da primeira
execução.

---

### Quero começar do zero, apagando tudo

**Isto apaga os dados de demonstração e tudo o que você cadastrou.** Não há volta.
No fluxo normal não existe comando que faça isso, justamente para não acontecer
por acidente.

Se você realmente quiser, abra o Prompt de Comando na pasta do SWI e rode:

```
docker compose -f docker-compose.client.yml --env-file swi-client.env down -v
```

Depois rode o `START-SWI.cmd`, que reconstrói o banco e recarrega a demonstração.

---

## O aplicativo Android

### O Android bloqueia a instalação

**Sintoma.** "Por segurança, seu telefone não pode instalar apps desconhecidos
desta fonte."

**Causa.** O aplicativo é distribuído fora da Play Store.

**O que fazer.** Toque em **Configurações** no próprio aviso, ative
**Permitir desta fonte** para o aplicativo que está abrindo o APK (o gerenciador
de arquivos, o Drive ou o navegador), volte e instale.

---

### "App não instalado"

Causas comuns, nesta ordem:

1. **Já existe uma versão instalada** assinada com outra chave. Desinstale a
   anterior e instale de novo.
2. **O arquivo chegou corrompido.** Confira a impressão digital do arquivo com o
   `SHA256SUMS.txt`. No Windows, no Prompt de Comando:

   ```
   certutil -hashfile SWI-Android-1.0.1.apk SHA256
   ```

   O valor precisa bater com o que está no `SHA256SUMS.txt`. Se não bater, o
   download falhou; baixe de novo.
3. **Falta espaço** no celular.

---

### O aplicativo abre mas não entra / diz que está sem conexão

O aplicativo conversa com a **API pública na internet**
(`https://api.kavicki.com`), e não com o site que você subiu na sua máquina.

Confira, nesta ordem:

1. **O celular tem internet?** Teste abrindo qualquer site no navegador dele.
2. **Você está usando a conta certa?** As contas `admin@swi.local` e
   `worker@swi.local` existem **só na instalação local** e não funcionam no
   aplicativo. Use a conta de demonstração enviada separadamente.
3. **A API pública está no ar?** Abra <https://api.kavicki.com/health> no
   navegador. Deve responder `{"status":"ok"}`.

---

### O aplicativo não mostra o mapa ou não pega a localização

A permissão de localização foi recusada. Abra, dentro do aplicativo,
**Configurações > Preferências** e ligue **Localização**, ou vá nos ajustes do
Android, em Aplicativos > SWI > Permissões.

---

### Não recebo notificações no celular

**Notificação push não faz parte deste build.** O aplicativo tem uma central de
notificações interna, que você abre dentro dele, mas o sistema não empurra aviso
para a barra de status do Android nesta versão. O botão de notificações na tela
de Preferências é visual.

---

## Ainda não resolveu

Junte estas três coisas antes de pedir ajuda, porque são elas que permitem
diagnosticar sem chute:

1. **O que apareceu na tela**, de preferência em foto ou captura.
2. **A saída dos registros**, gerada com o Prompt de Comando aberto na pasta do
   SWI:

   ```
   docker compose -f docker-compose.client.yml --env-file swi-client.env logs > logs-swi.txt
   ```

   O arquivo `logs-swi.txt` aparece na mesma pasta.
3. **Qual passo você estava fazendo** quando o problema apareceu.
