# mobile

App do trabalhador do SWI, para Android e iOS: login e cadastro, jornada de trabalho com operação offline, GPS em segundo plano, chat, tarefas e relatórios com fotos, alertas e evacuação, transmissão ao vivo da câmera e monitoramento de saúde com Apple Watch. Inclui o app de relógio (watchOS) em `targets/watch/`.

Stack: Expo SDK 54 com Expo Router 6, React Native 0.81, React 19.1, MapLibre para mapas, react-native-webrtc para a transmissão e socket.io-client para o tempo real. Os componentes visuais e os tokens vêm do design system `@kavicki/swi-design-system`, distribuído como pacote em `vendor/`.

## Pré-requisitos

- Node.js na faixa `>=22.11.0 <23` e npm `>=10.9.0 <11`. A versão de referência é a de `.nvmrc` na raiz (22.23.2). O `.npmrc` tem `engine-strict=true`, então a instalação recusa outra versão.
- A API do SWI acessível. Ver `../swi-backend/README.md`.
- **Android:** JDK 17 e Android SDK (o Android Studio instala o SDK; o Gradle baixa NDK 27 e CMake na primeira compilação). SDK de compilação 36, mínimo Android 7 (API 24).
- **iOS:** macOS com Xcode e CocoaPods, e uma conta Apple Developer. O app do relógio exige watchOS 10 ou superior.

O app usa módulos nativos (transmissão de câmera, mapas, HealthKit), então **não roda no Expo Go**: em aparelho ou emulador ele precisa de um build de desenvolvimento ou de release, gerados como descrito abaixo.

## Instalação

```bash
cd mobile
npm ci
cp .env.example .env
```

## Como rodar

### Build de desenvolvimento

```bash
npx expo run:android
```

Gera as pastas nativas (se ainda não existem), compila um build de desenvolvimento, instala no emulador ou no aparelho conectado por USB e inicia o servidor do Metro. No macOS, `npx expo run:ios` faz o mesmo para o simulador ou um iPhone conectado.

Com o build de desenvolvimento já instalado, basta subir o servidor:

```bash
npm start
```

O `.env` decide de onde vêm os dados em desenvolvimento. O padrão do `.env.example` é `mock` (dados simulados em memória, sem API). Para usar a API local, troque `EXPO_PUBLIC_DATA_BACKEND` e `EXPO_PUBLIC_AUTH_BACKEND` para `api` e ajuste `EXPO_PUBLIC_API_URL`: no emulador Android, `http://10.0.2.2:3000`; em aparelho físico, o IP da máquina na rede local.

O prebuild, inclusive o disparado por `expo run`, reescreve os scripts `android` e `ios` do `package.json`. Descarte essa alteração (`git checkout package.json`). As pastas `android/` e `ios/` são geradas e não são versionadas.

### Web

`npm run web` abre o app no navegador, só para desenvolvimento. O produto web do SWI é o painel (`swi-admin`); num build de release, a versão web do app mostra apenas um aviso.

## Testes

Os mesmos passos do job `mobile` de `.github/workflows/ci.yml`:

```bash
cd mobile
npm ci
npx expo-doctor
npm run lint
npm run typecheck
npm run test:coverage
npm run build:all
```

- `npx expo-doctor` confere a coerência do projeto Expo (versões compatíveis com o SDK, configuração válida).
- `npm run test:coverage` roda o Jest com cobertura mínima de 80%.
- `npm run build:all` exporta os bundles de Android, iOS e web: é a verificação de que o JavaScript fecha nas três plataformas.

O teste de navegador do app web roda localmente com `npm run test:e2e:managed` (Docker e Chromium do Playwright, como no painel) e fica fora do CI.

`npm run verify` encadeia lint, typecheck, testes e `build:all`.

## Build de release sem o EAS

O projeto também tem perfis do EAS (ver abaixo), mas os builds de release podem ser gerados localmente, sem conta Expo.

As variáveis `EXPO_PUBLIC_*` são gravadas no bundle **no momento do build**. As de release são as do perfil `qa` do `eas.json`:

```bash
export EXPO_PUBLIC_API_URL=https://api.kavicki.com
export EXPO_PUBLIC_AUTH_BACKEND=api
export EXPO_PUBLIC_DATA_BACKEND=api
export EXPO_PUBLIC_MEDIA_ORIGINS=https://c5cacf2d100d6bf7d0bd43eebc686567.r2.cloudflarestorage.com
```

`EXPO_PUBLIC_ALLOW_DEMO_MOCKS` fica de fora: é sem ela que o build de release recusa dados simulados. Variáveis definidas no ambiente vencem as do `.env`.

### Android (APK e AAB)

1. **Projeto nativo.**

   ```bash
   cd mobile
   npx expo prebuild --platform android --no-install
   git checkout package.json
   ```

2. **Memória do Gradle.** Em `android/gradle.properties`, troque a linha `org.gradle.jvmargs` por:

   ```properties
   org.gradle.jvmargs=-Xmx6g -XX:MaxMetaspaceSize=2g
   ```

   Com o padrão do template, a compilação do Kotlin estoura a memória. A compilação nativa também pede bastante memória livre na máquina, na casa de uma dezena de GB.

3. **Chave de assinatura.** O template assina o release com a chave de depuração, que não serve para distribuição. Gere uma chave própria uma única vez e guarde-a fora do repositório (perder a chave impede publicar atualizações do mesmo app):

   ```bash
   keytool -genkeypair -v -storetype PKCS12 -keystore swi-release.jks -alias swi -keyalg RSA -keysize 2048 -validity 10000
   ```

   Em `android/app/build.gradle`, dentro do bloco `signingConfigs { ... }` que já existe, acrescente uma configuração que lê a chave do ambiente:

   ```groovy
   release {
       if (System.getenv("SWI_KEYSTORE")) {
           storeFile file(System.getenv("SWI_KEYSTORE"))
           storePassword System.getenv("SWI_KEYSTORE_PASSWORD")
           keyAlias System.getenv("SWI_KEY_ALIAS")
           keyPassword System.getenv("SWI_KEY_PASSWORD")
       }
   }
   ```

   A condição mantém os builds de desenvolvimento funcionando sem as variáveis da chave; sem ela, o Gradle falha na configuração com "Cannot convert 'null' to File".

   E, no bloco `buildTypes { release { ... } }`, troque `signingConfig signingConfigs.debug` por `signingConfig signingConfigs.release`. O `android/` é regerado a cada prebuild, então este passo se repete quando o prebuild rodar de novo.

4. **Build.** Com as variáveis `EXPO_PUBLIC_*` acima e as `SWI_KEYSTORE`, `SWI_KEYSTORE_PASSWORD`, `SWI_KEY_ALIAS` e `SWI_KEY_PASSWORD` exportadas:

   ```bash
   cd android
   ./gradlew assembleRelease --no-daemon
   ./gradlew bundleRelease --no-daemon
   ```

   No Windows, `gradlew.bat`. Saídas: `android/app/build/outputs/apk/release/app-release.apk` (instalação direta) e `android/app/build/outputs/bundle/release/app-release.aab` (Google Play). Confira a assinatura do APK com `apksigner verify --print-certs` (Android SDK, pasta `build-tools`).

Antes de cada nova publicação, aumente `expo.version` e `expo.android.versionCode` em `app.json`. Um APK assinado com outra chave não instala por cima de uma versão já instalada: é preciso desinstalar antes.

### iOS (Xcode, conta Apple do cliente)

Só em macOS.

1. **Identidade.** Em `app.json`, troque `expo.ios.appleTeamId` pelo Team ID da conta Apple Developer que vai publicar. Se o identificador `com.kavicki.swi` não for transferido para essa conta, troque também `expo.ios.bundleIdentifier`; o app do relógio usa o mesmo identificador seguido de `.watchkitapp`. Na conta Apple, registre os dois identificadores com a capability HealthKit.
2. **Projeto nativo.**

   ```bash
   cd mobile
   npx expo prebuild --platform ios
   git checkout package.json
   ```

   O prebuild gera `ios/`, inclui o target do relógio a partir de `targets/watch/` e roda o `pod install`.
3. **Ambiente do bundle.** O Xcode não herda as variáveis do terminal. Crie `ios/.xcode.env.local` com as linhas `export EXPO_PUBLIC_...` da seção acima; a etapa que empacota o JavaScript lê esse arquivo.
4. **Assinatura.** Abra `ios/SWI.xcworkspace` no Xcode. Em *Signing & Capabilities*, selecione o time nos targets `SWI` e `SWIWatch`.
5. **Build.** Selecione *Any iOS Device*, use *Product > Archive* e, no Organizer, *Distribute App > App Store Connect* para enviar ao TestFlight ou à App Store.

Antes de cada envio, aumente `expo.version` em `app.json` ou o número do build no Xcode: o App Store Connect recusa número de build repetido.

### Perfis do EAS

O `eas.json` define os perfis usados com o serviço de build do Expo. Todos rodam com Node 22.23.2.

| Perfil | Uso | API |
| --- | --- | --- |
| `development` | build de desenvolvimento (APK, iPhone físico) | do `.env` |
| `development-simulator` | build de desenvolvimento para o simulador iOS | do `.env` |
| `preview` | APK e simulador iOS para revisão interna | `https://api.kavicki.com` |
| `qa` | APK e iPhone para homologação, com incremento automático de versão | `https://api.kavicki.com` |
| `qa-testflight` | envio ao TestFlight | `https://api.kavicki.com` |
| `production` | lojas | `https://api.kavicki.com` |

Os perfis apontados para a API declaram `EXPO_PUBLIC_API_URL`, `EXPO_PUBLIC_AUTH_BACKEND=api`, `EXPO_PUBLIC_DATA_BACKEND=api` e `EXPO_PUBLIC_MEDIA_ORIGINS` (a origem do armazenamento de mídia de produção, o Cloudflare R2). Para usar o EAS com outra conta Expo, troque `expo.owner` e `expo.extra.eas.projectId` em `app.json` (o comando `eas init` faz isso) e o `ascAppId` de `submit` no `eas.json` pelo app da conta Apple que vai publicar. Exemplo: `eas build --profile qa --platform android`.

## Variáveis de ambiente

Lidas de `.env` em desenvolvimento e do ambiente do build (ou do `env` do perfil do EAS) em release. Só variáveis com o prefixo `EXPO_PUBLIC_` chegam ao app, e elas ficam legíveis por quem tiver o APK: **nenhuma** pode conter segredo.

"Desenvolvimento" abaixo inclui o Metro em modo de desenvolvimento e a suíte de testes. Fora dele, o app ignora as fontes simuladas e recusa endereço local.

| Variável | Padrão | Significado |
| --- | --- | --- |
| `EXPO_PUBLIC_API_URL` | `http://localhost:3000` só em desenvolvimento | Endereço base da API. Obrigatória em release, onde endereço local é recusado. |
| `EXPO_PUBLIC_DATA_BACKEND` | `mock` em desenvolvimento; sempre `api` em release | Fonte dos dados que não são de saúde (perfil, relatórios, jornada, chat, notificações, clima, evacuação, posições): `api` ou `mock`. Outro valor impede o app de abrir. |
| `EXPO_PUBLIC_AUTH_BACKEND` | `mock` em desenvolvimento; sempre `api` em release | Fonte do login e do cadastro: `api` ou `mock`. |
| `EXPO_PUBLIC_MEDIA_ORIGINS` | | Origens HTTPS exatas, separadas por vírgula, de onde o app aceita abrir mídia (arquivos de exame), além da própria API. Em release, precisa conter a origem do armazenamento de mídia (esquema e host de uma URL assinada que a API devolve, sem caminho), senão o app recusa abrir exames com "origem não autorizada". |
| `EXPO_PUBLIC_ALLOW_DEMO_MOCKS` | desligada | `1` libera dados simulados e endereço local fora de desenvolvimento, para demonstrar o app sem API. Nunca use em build distribuído: o usuário veria dados fabricados. |

## Estrutura

```
mobile/
  app/              rotas (Expo Router, por arquivo)
    (auth)/         login, cadastro, recuperação e confirmação de conta
    (onboarding)/   pareamento do relógio
    (app)/          área autenticada
    modals/         modais
  components/       composições de tela
  services/         acesso à API por domínio, tempo real, fila offline e dados simulados
  lib/              configuração de ambiente, validação, mapas e utilitários
  modules/          módulo nativo de controle do relógio
  targets/watch/    app do Apple Watch (Swift)
  assets/           ícones, splash e imagens
  vendor/           pacote do design system
  e2e/              teste de navegador do app web
  app.json          configuração do Expo (identificadores, permissões, plugins)
  eas.json          perfis do EAS
```
