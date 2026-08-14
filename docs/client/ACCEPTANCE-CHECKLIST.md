# Checklist de aceite

Roteiro para conferir, item por item, o que foi entregue. Cada linha traz o que
fazer e **o resultado esperado**, para que a conferência não dependa de
interpretação.

Sugestão de uso: imprima ou preencha os colchetes com `x`. Onde algo falhar,
anote o que apareceu na tela; isso é o que permite diagnosticar depois.

- **Data da conferência:** ______________________
- **Responsável:** ______________________
- **Versão conferida:** `1.0.1`

---

## A. O pacote chegou íntegro

| | Item | Resultado esperado |
| --- | --- | --- |
| [ ] | Os quatro arquivos chegaram | `SWI-source-1.0.1.zip`, `SWI-Android-1.0.1.apk`, `SHA256SUMS.txt` e `DELIVERY-MANIFEST.json` |
| [ ] | O ZIP descompacta sem erro | A pasta abre com `START-SWI.cmd`, `STOP-SWI.cmd`, `swi-backend/`, `swi-admin/` e `mobile/` dentro |
| [ ] | As impressões digitais batem | `certutil -hashfile <arquivo> SHA256` devolve, para o ZIP e para o APK, o mesmo valor listado no `SHA256SUMS.txt` |
| [ ] | O manifesto está legível | `DELIVERY-MANIFEST.json` traz commit, data, versões de Node e npm, e a lista de arquivos com tamanho e hash |
| [ ] | O pacote não contém segredo | Não existe nenhum arquivo `.env` real, nenhuma chave de assinatura de aplicativo e nenhuma credencial da API pública dentro do ZIP |

---

## B. O site sobe por duplo clique

| | Item | Resultado esperado |
| --- | --- | --- |
| [ ] | Docker Desktop instalado e iniciado | O ícone mostra "Engine running" |
| [ ] | Duplo clique em `START-SWI.cmd` | A janela preta percorre as oito etapas sem erro vermelho |
| [ ] | O navegador abre sozinho | A tela de login do painel aparece em `http://localhost:5173` |
| [ ] | A API responde | `http://localhost:3000/health` devolve `{"status":"ok"}` |
| [ ] | A caixa de e-mail de teste responde | `http://localhost:8025` abre a lista de mensagens |
| [ ] | As credenciais foram exibidas | A janela preta mostrou `admin@swi.local` e `worker@swi.local` com as senhas |
| [ ] | Rodar de novo não quebra | Um segundo duplo clique em `START-SWI.cmd`, com tudo de pé, termina sem erro e diz que a configuração existente foi preservada |
| [ ] | Nada fica exposto na rede | Os endereços acima só respondem nesta máquina. De outro computador da rede, não abrem |

---

## C. O painel administrativo

Entre com `admin@swi.local` / `admin123`.

### C.1 Entrada e saída

| | Item | Resultado esperado |
| --- | --- | --- |
| [ ] | Login com a senha certa | Entra no painel |
| [ ] | Login com a senha errada | Recusa com mensagem de erro, sem travar |
| [ ] | Sair e entrar de novo | O botão de sair volta ao login; entrar de novo funciona |
| [ ] | Recuperação de senha | Pedir a redefinição envia um código, que aparece em `http://localhost:8025`; com ele dá para definir a nova senha e entrar |

### C.2 Cadastro de usuário com aprovação

| | Item | Resultado esperado |
| --- | --- | --- |
| [ ] | Criar uma conta nova pela tela de cadastro | O cadastro é aceito e o sistema pede a confirmação por código |
| [ ] | O código chega | A mensagem aparece em `http://localhost:8025` |
| [ ] | Confirmar o código | A confirmação é aceita |
| [ ] | Tentar entrar antes da aprovação | O acesso é **recusado**. Isso é o esperado, é o portão de aprovação funcionando |
| [ ] | Aprovar | Como administrador, em **Funcionários > Pendentes**, o cadastro aparece na fila e o botão **Aprovar** o retira dela |
| [ ] | Entrar depois de aprovado | Agora entra |

### C.3 As telas

| | Item | Resultado esperado |
| --- | --- | --- |
| [ ] | Dashboard | Abre com os indicadores, as atividades, os alertas de desgaste e a previsão do tempo preenchidos |
| [ ] | Funcionários | A lista traz os trabalhadores da demonstração; abrir um mostra a ficha com setor, função e dados de saúde |
| [ ] | Cadastrar funcionário | O formulário salva e o novo nome aparece na lista |
| [ ] | Administradores | A lista abre e o cadastro de um novo administrador funciona |
| [ ] | Mapa | O mapa abre com os trabalhadores posicionados |
| [ ] | Alertas e rota de resgate | Abrir um alerta permite escolher quem vai resgatar e traçar a rota até a pessoa |
| [ ] | Monitoramento | As abas de alertas e de boas condições listam os trabalhadores |
| [ ] | Relatórios | A lista abre e um relatório existente mostra a foto anexada |
| [ ] | Criar relatório com foto | O formulário aceita anexar uma imagem, salva, e a imagem aparece ao reabrir o relatório |
| [ ] | Tarefas | Criar, abrir e editar uma tarefa funciona |
| [ ] | Chat | As conversas abrem, dá para enviar mensagem e anexar imagem |
| [ ] | Perfil e configurações | As telas abrem e as alterações salvam |
| [ ] | Selo de dados simulados | As telas com batimentos, temperatura e desgaste exibem o selo **"Dados simulados"** |

---

## D. Os dados sobrevivem ao desligamento

| | Item | Resultado esperado |
| --- | --- | --- |
| [ ] | Criar algo reconhecível | Um funcionário, uma tarefa ou um relatório com nome fácil de achar |
| [ ] | Duplo clique em `STOP-SWI.cmd` | Os serviços desligam sem erro |
| [ ] | Duplo clique em `START-SWI.cmd` | Sobe de novo, e **bem mais rápido** que a primeira vez |
| [ ] | O que você criou continua lá | O item aparece na lista, com o mesmo conteúdo |
| [ ] | Você continua logado ou entra com a mesma senha | A chave de segurança não foi trocada |
| [ ] | Nada duplicou | A demonstração não aparece em dobro depois do segundo início |

---

## E. O aplicativo Android

O aplicativo conversa com a **API pública na internet**, não com o site local.
Use a conta de demonstração enviada separadamente, e não as contas `@swi.local`.

| | Item | Resultado esperado |
| --- | --- | --- |
| [ ] | Instalação do APK | Instala depois de autorizar a fonte desconhecida |
| [ ] | Primeiro início | Abre na tela de login sem travar |
| [ ] | Login | Entra com a conta de demonstração |
| [ ] | Dashboard e navegação | As telas principais abrem e a navegação entre elas funciona |
| [ ] | Mapa e localização | Ao pedir a permissão de localização e conceder, o mapa mostra a posição |
| [ ] | Permissão de câmera | Ao tirar foto pela primeira vez, o Android pede a permissão |
| [ ] | Permissão de galeria | Ao escolher imagem, o Android pede a permissão |
| [ ] | Recusar uma permissão | O aplicativo continua funcionando; só a função correspondente fica indisponível |
| [ ] | Enviar relatório com foto | O envio conclui e a imagem aparece ao reabrir |
| [ ] | Chat | Abre a conversa e envia mensagem |
| [ ] | Relatórios, jornada, clima e evacuação | As telas abrem com conteúdo |
| [ ] | Sem internet | Desligar os dados do celular faz o aplicativo **avisar a falha na tela**, em vez de travar ou fechar |
| [ ] | Sair e entrar de novo | O logout volta ao login e o login seguinte funciona |
| [ ] | Versão | A versão exibida é `1.0.1` |

---

## F. Limitações declaradas

Estes itens **não são defeito**. Estão listados aqui para ficarem conferidos e
registrados como esperados, e não cobrados como falha.

| | Item |
| --- | --- |
| [ ] | Batimentos, temperatura e nível de desgaste são gerados pelo sistema, não lidos de pulseira. Passam a ser reais quando a smartband for adquirida e integrada |
| [ ] | O pareamento Bluetooth da pulseira, no aplicativo, é simulado pelo mesmo motivo |
| [ ] | Na instalação local, a posição dos trabalhadores varia sozinha e há um alerta de tempestade ativo, para as telas não ficarem estáticas na demonstração. A API pública não faz nem uma coisa nem outra |
| [ ] | Nenhum e-mail sai para a internet na instalação local; todos param em `http://localhost:8025` |
| [ ] | iOS não faz parte desta entrega: nenhuma build de iPhone foi gerada, assinada ou testada |
| [ ] | O aplicativo não é suportado em navegador. O produto web entregue é o painel administrativo |
| [ ] | Notificação push pelo sistema operacional não faz parte deste build. O aplicativo tem central de notificações interna |
| [ ] | O aviso `SecretsUsedInArgOrEnv` durante a construção é falso positivo, explicado no `TROUBLESHOOTING.md` |
| [ ] | As contas `admin@swi.local` e `worker@swi.local` só existem na instalação local e não dão acesso a nada pela internet |

---

## G. O código-fonte

Para quem for revisar tecnicamente. Exige Node 22 instalado.

| | Item | Resultado esperado |
| --- | --- | --- |
| [ ] | O fonte dos três projetos está no ZIP | `swi-backend/`, `swi-admin/` e `mobile/`, com testes e migrations |
| [ ] | A configuração de integração contínua veio junto | `.github/workflows/ci.yml`, com os jobs de teste, cobertura, ponta a ponta e segurança |
| [ ] | Os testes rodam | Em cada projeto, `npm ci` seguido de `npm test` termina sem falha |
| [ ] | As migrations do banco estão versionadas | `swi-backend/prisma/migrations/` traz o histórico |
| [ ] | Não há `node_modules` nem build no pacote | O ZIP traz fonte, não artefato compilado |

---

## Registro

**Resultado:** [ ] Aceito  [ ] Aceito com ressalvas  [ ] Não aceito

**Ressalvas ou falhas encontradas:**

```
```

**Assinatura:** ______________________  **Data:** ____ / ____ / ________
