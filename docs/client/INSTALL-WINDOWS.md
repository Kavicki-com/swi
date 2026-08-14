# Instalação no Windows

Este documento é para quem recebeu o pacote do SWI e quer ver o sistema
funcionando. Não é preciso saber programar, e não é preciso instalar Node, npm,
Git nem banco de dados.

**O único programa que você precisa instalar é o Docker Desktop.**

---

## 1. O que você recebeu

| Arquivo | O que é |
| --- | --- |
| `SWI-source-1.0.1.zip` | Todo o código-fonte do sistema: API, painel web e aplicativo |
| `SWI-Android-1.0.1.apk` | O aplicativo Android, pronto para instalar no celular |
| `SHA256SUMS.txt` | Impressões digitais dos arquivos acima, para conferir se chegaram íntegros |
| `DELIVERY-MANIFEST.json` | Ficha técnica do pacote: commit, versões, data, tamanhos |

O ZIP e o APK são **independentes um do outro**. Você pode instalar o aplicativo
no celular sem descompactar o ZIP, e pode subir o site sem instalar o aplicativo.

---

## 2. Requisitos

| Item | Detalhe |
| --- | --- |
| Sistema | Windows 10 ou Windows 11, 64 bits |
| Programa | [Docker Desktop](https://www.docker.com/products/docker-desktop/), gratuito |
| Memória | 8 GB de RAM no total já é suficiente |
| Disco | Reserve **10 GB livres** (veja a seção 8) |
| Internet | **Obrigatória na primeira execução.** Depois dela o site funciona offline |
| Permissão | A instalação do Docker Desktop pede permissão de administrador do Windows. Subir o SWI depois disso, não |

### Por que internet é obrigatória

Três coisas diferentes dependem dela, e vale distinguir:

1. **Primeira execução do site**: o Docker baixa as imagens do PostgreSQL, do
   MinIO e do MailHog, e busca as bibliotecas usadas para compilar a API e o
   painel. É um download grande, feito uma única vez.
2. **Aplicativo Android**: ele conversa com a API pública em
   `https://api.kavicki.com`, então precisa de internet **sempre**, em todo uso.
3. **Desenvolvimento do código-fonte**: instalar as dependências dos três
   projetos exige acesso ao registro público do npm.

Depois da primeira execução, o site sobe sem internet: tudo o que ele usa já está
na sua máquina.

---

## 3. Instalar o Docker Desktop

1. Baixe em <https://www.docker.com/products/docker-desktop/> e escolha
   **Docker Desktop for Windows**.
2. Execute o instalador e aceite as opções padrão. Se ele oferecer usar o WSL 2,
   aceite.
3. **Reinicie o computador** se o instalador pedir.
4. Abra o Docker Desktop pelo menu Iniciar.
5. Espere o ícone da baleia parar de animar. Quando aparecer **"Engine running"**
   no canto inferior, ele está pronto.

Deixe o Docker Desktop aberto. Ele precisa estar rodando para o SWI subir.

---

## 4. Subir o site e o backend

1. Descompacte o `SWI-source-1.0.1.zip` em qualquer pasta. Caminhos com espaço no
   nome funcionam.
2. Abra a pasta descompactada.
3. **Duplo clique em `START-SWI.cmd`.**

Uma janela preta abre e mostra o que está acontecendo, passo a passo:

```
==> Verificando o Docker Desktop
==> Preparando a configuracao local
==> Verificando as portas
==> Construindo e subindo os servicos (a primeira vez demora, baixa imagens)
==> Esperando a API responder (aplica as migracoes do banco no boot)
==> Carregando os dados de demonstracao
==> Esperando o site
==> Abrindo o navegador
```

**A primeira execução demora**, porque ela baixa alguns gigabytes e compila o
sistema. As seguintes são rápidas: nada é baixado nem compilado de novo.

Quando terminar, o navegador abre sozinho em `http://localhost:5173` e a janela
preta mostra os endereços e as senhas. **Não feche a janela preta enquanto
estiver usando o sistema pela primeira vez**: é lá que os erros apareceriam.

### Se aparecer um erro

Vá para [`TROUBLESHOOTING.md`](TROUBLESHOOTING.md). As duas falhas mais prováveis
(Docker Desktop fechado e porta ocupada) estão lá com a solução.

---

## 5. Os endereços e para que servem

| Endereço | O que é | Você usa? |
| --- | --- | --- |
| <http://localhost:5173> | **O painel administrativo.** É aqui que o trabalho acontece | Sim, é a tela principal |
| <http://localhost:8025> | **Caixa de entrada de teste.** Todo e-mail que o sistema enviar cai aqui | Sim, para pegar códigos de verificação |
| <http://localhost:3000/health> | Sinal de vida da API. Deve mostrar `{"status":"ok"}` | Só para conferir se está no ar |
| <http://localhost:9001> | Painel dos arquivos enviados (fotos de relatório, anexos de chat) | Raramente. Usuário `minioadmin`, senha `minioadmin` |

Todos eles respondem **somente nesta máquina**. Ninguém na rede da empresa, nem
na internet, alcança esses endereços. É proposital.

### Sobre a caixa de entrada de teste

Nesta instalação local, **nenhum e-mail sai para a internet**. Quando o sistema
manda um código de verificação de cadastro ou de redefinição de senha, a mensagem
para em `http://localhost:8025`. Abra esse endereço, clique na mensagem e leia o
código ali.

Isso é o correto para uma demonstração: ela não depende de servidor de e-mail
configurado e não corre o risco de mandar mensagem para o endereço de alguém.

---

## 6. Entrar no sistema

O `START-SWI` carrega dados de demonstração e cria duas contas:

| Perfil | E-mail | Senha |
| --- | --- | --- |
| Administrador | `admin@swi.local` | `admin123` |
| Trabalhador | `worker@swi.local` | `worker123` |

Use a conta de **administrador** para navegar no painel: é o perfil que enxerga
tudo.

> Estas duas contas existem **apenas no banco de dados que o Docker criou na sua
> máquina**. Elas não dão acesso a nada pela internet, e não são as credenciais
> da API pública usada pelo aplicativo. As credenciais da API pública, quando
> aplicáveis, são enviadas por canal separado e não fazem parte deste pacote.

Junto com as contas vêm dados de demonstração: uma empresa, trabalhadores com
setor, função e tipo sanguíneo, conversas de chat, relatórios com fotos, tarefas,
alertas e uma previsão do tempo. É o suficiente para percorrer todas as telas.

---

## 7. Desligar

**Duplo clique em `STOP-SWI.cmd`.**

Ele desliga os containers e **preserva os dados**. O que você cadastrou continua
lá na próxima vez que rodar o `START-SWI.cmd`, e a chave de segurança gerada na
primeira execução não é trocada, então nenhuma sessão é invalidada por acidente.

Não existe, no fluxo normal, nenhum comando que apague os dados.

Fechar o Docker Desktop, desligar o computador ou fechar a janela preta também
não apagam nada, mas o jeito limpo de parar é o `STOP-SWI.cmd`.

---

## 8. Quanto de disco isso ocupa

Depois da primeira execução, o Docker guarda:

| Item | Tamanho aproximado |
| --- | --- |
| Imagem do PostgreSQL (banco de dados) | 640 MB |
| Imagem do MailHog (caixa de e-mail) | 570 MB |
| Imagem do MinIO (arquivos) | 240 MB |
| Imagem da API do SWI | 600 MB |
| Imagem usada para carregar os dados de demonstração | 890 MB |
| Imagem do painel web | 100 MB |
| Seus dados (banco + arquivos enviados) | Alguns megabytes, cresce com o uso |

As duas imagens do SWI compartilham boa parte do conteúdo entre si, então o
espaço realmente consumido fica **abaixo da soma**, por volta de 3 GB. Durante a
primeira construção o Docker também usa um cache temporário que pode passar
disso. Por isso a recomendação de **10 GB livres**: é folga, não exigência exata.

Se um dia quiser recuperar o espaço, o Docker Desktop tem, em
**Settings > Resources > Advanced**, o botão de limpeza, e a aba **Images**
permite remover imagens uma a uma. Removê-las não apaga seus dados, mas faz a
próxima execução do `START-SWI.cmd` baixar tudo de novo.

---

## 9. Instalar o aplicativo Android

O arquivo é `SWI-Android-1.0.1.apk`.

1. Copie o APK para o celular (cabo USB, Google Drive, e-mail, o que for mais
   prático).
2. Abra o arquivo pelo gerenciador de arquivos do celular.
3. O Android vai avisar que o app não veio da Play Store e pedir permissão para
   instalar de fonte desconhecida. Toque em **Configurações**, ative
   **Permitir desta fonte** e volte.
4. Toque em **Instalar** e depois em **Abrir**.

Isso é normal e esperado: o aplicativo é distribuído fora da Play Store, então o
Android pede essa confirmação uma vez.

### Permissões que o aplicativo pede

| Permissão | Quando é pedida | Para quê |
| --- | --- | --- |
| **Localização** | Ao abrir o mapa ou ligar o item na tela de Preferências | Mostrar a posição do trabalhador no mapa e calcular a rota de resgate |
| **Câmera** | Ao tirar foto para um relatório ou uma mensagem | Anexar a foto |
| **Fotos e arquivos** | Ao escolher uma imagem da galeria | Anexar a imagem |

Você pode recusar qualquer uma delas: o aplicativo continua abrindo, só a função
correspondente fica indisponível. Para revisar depois, use a tela
**Configurações > Preferências** dentro do aplicativo, que reflete o estado real
das permissões do Android, ou os ajustes do próprio sistema.

O item **Notificações** dessa tela é visual nesta versão: o envio de notificação
push pelo sistema operacional não faz parte deste build.

### De onde o aplicativo tira os dados

O aplicativo **não** usa o site que você subiu na sua máquina. Ele conversa com a
API pública, em `https://api.kavicki.com`, e por isso precisa de internet.

Consequência: as contas `admin@swi.local` e `worker@swi.local` **não funcionam no
aplicativo**, e o que você cadastra no painel local não aparece nele. Para entrar
no aplicativo, use a conta de demonstração enviada separadamente.

Se a API pública estiver fora do ar, o aplicativo abre e avisa a falha na tela em
vez de travar.

---

## 10. Limitações desta entrega

Declaradas aqui para não haver surpresa depois:

- **Sinais vitais e desgaste são simulados.** O sistema gera batimentos,
  temperatura e nível de desgaste em vez de ler de um dispositivo. Isso é decisão
  de produto: esses números passam a ser reais quando a pulseira (smartband) for
  adquirida e integrada. As telas já estão prontas para receber o dado real, e o
  painel marca cada uma delas com o selo **"Dados simulados"**, para ninguém
  confundir número gerado com leitura de sensor.
- **O pareamento Bluetooth da pulseira** no aplicativo é uma simulação, pelo
  mesmo motivo.
- **Na demonstração local**, a posição dos trabalhadores no mapa varia sozinha e
  há um alerta de tempestade ativo, para o mapa e a tela de clima não ficarem
  estáticos. A API pública não faz nem uma coisa nem outra.
- **iOS não faz parte da entrega.** Nenhuma build de iPhone foi gerada nem
  testada, e publicar na App Store exige conta paga de desenvolvedor Apple.
- **O aplicativo não é suportado em navegador.** O produto web entregue é o
  painel administrativo.
- **Notificações push não estão neste build.**

---

## 11. Para quem for desenvolver

O ZIP contém o código-fonte completo dos três projetos, com testes, migrations do
banco e configuração de integração contínua. As instruções de desenvolvimento
estão no `README.md` da raiz. Aí, sim, é preciso instalar o Node 22.
