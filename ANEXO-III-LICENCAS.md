# Anexo III: bibliotecas de terceiros e licenças

Relação das bibliotecas usadas diretamente pelos três projetos do SWI, com a versão instalada pelo lockfile de cada um e a licença declarada pelo próprio pacote.

Cada biblioteca permanece sob a própria licença, e nada neste anexo altera esses termos. As dependências transitivas (as dependências das bibliotecas listadas) também seguem as próprias licenças, que acompanham cada pacote em `node_modules/` após a instalação; a árvore completa de cada projeto pode ser listada com `npm ls --all`.

- **Dependências de execução** (`dependencies`) fazem parte do produto em funcionamento.
- **Dependências de desenvolvimento** (`devDependencies`) só são usadas para compilar, testar e verificar o código, e não são distribuídas com o produto.

A biblioteca `@kavicki/swi-design-system` é o design system do SWI, de propriedade da Kavicki, e não é de terceiro. Ela acompanha o código-fonte como pacote em `vendor/` no painel e no app.

Licenças fora de MIT, ISC, BSD e Apache-2.0 são marcadas com **Atenção** e reunidas na seção final.

Este arquivo é gerado por `node scripts/licenses/generate-anexo-iii.mjs` a partir das dependências instaladas (`npm ci` em cada projeto). Não edite à mão: rode o gerador de novo depois de qualquer mudança de dependência.

## API (`swi-backend`)

### Dependências de execução

| Pacote | Versão | Licença | Observação |
| --- | --- | --- | --- |
| `@aws-sdk/client-s3` | 3.1079.0 | Apache-2.0 |  |
| `@aws-sdk/s3-request-presigner` | 3.1079.0 | Apache-2.0 |  |
| `@nestjs/common` | 10.4.22 | MIT |  |
| `@nestjs/core` | 10.4.22 | MIT |  |
| `@nestjs/jwt` | 10.2.0 | MIT |  |
| `@nestjs/passport` | 10.0.3 | MIT |  |
| `@nestjs/platform-express` | 10.4.22 | MIT |  |
| `@nestjs/platform-socket.io` | 10.4.22 | MIT |  |
| `@nestjs/schedule` | 6.1.3 | MIT |  |
| `@nestjs/swagger` | 7.4.2 | MIT |  |
| `@nestjs/throttler` | 6.5.0 | MIT |  |
| `@nestjs/websockets` | 10.4.22 | MIT |  |
| `@prisma/client` | 5.22.0 | Apache-2.0 |  |
| `bcrypt` | 6.0.0 | MIT |  |
| `class-transformer` | 0.5.1 | MIT |  |
| `class-validator` | 0.14.4 | MIT |  |
| `dotenv` | 17.4.2 | BSD-2-Clause |  |
| `nodemailer` | 10.0.13 | MIT-0 | **Atenção: licença fora de MIT, ISC, BSD e Apache-2.0** |
| `passport` | 0.7.0 | MIT |  |
| `passport-jwt` | 4.0.1 | MIT |  |
| `pg-boss` | 12.25.1 | MIT |  |
| `prisma` | 5.22.0 | Apache-2.0 |  |
| `reflect-metadata` | 0.2.2 | Apache-2.0 |  |
| `rxjs` | 7.8.2 | Apache-2.0 |  |

### Dependências de desenvolvimento

| Pacote | Versão | Licença | Observação |
| --- | --- | --- | --- |
| `@eslint/js` | 9.39.5 | MIT |  |
| `@nestjs/cli` | 10.4.9 | MIT |  |
| `@nestjs/testing` | 10.4.22 | MIT |  |
| `@types/bcrypt` | 5.0.2 | MIT |  |
| `@types/jest` | 29.5.14 | MIT |  |
| `@types/node` | 22.20.1 | MIT |  |
| `@types/nodemailer` | 6.4.24 | MIT |  |
| `@types/passport-jwt` | 4.0.1 | MIT |  |
| `@types/supertest` | 6.0.3 | MIT |  |
| `eslint` | 9.39.5 | MIT |  |
| `globals` | 15.15.0 | MIT |  |
| `jest` | 29.7.0 | MIT |  |
| `socket.io-client` | 4.8.3 | MIT |  |
| `supertest` | 7.2.2 | MIT |  |
| `ts-jest` | 29.4.11 | MIT |  |
| `ts-node` | 10.9.2 | MIT |  |
| `typescript` | 5.9.3 | Apache-2.0 |  |
| `typescript-eslint` | 8.66.0 | MIT |  |

## Painel web (`swi-admin`)

### Dependências de execução

| Pacote | Versão | Licença | Observação |
| --- | --- | --- | --- |
| `@kavicki/swi-design-system` | 0.1.141 | Proprietária (Kavicki) | Biblioteca própria da Kavicki |
| `maplibre-gl` | 6.11.2 | BSD-3-Clause |  |
| `react` | 18.3.1 | MIT |  |
| `react-dom` | 18.3.1 | MIT |  |
| `react-native-svg` | 15.15.4 | MIT |  |
| `react-native-svg-web` | 1.0.9 | MIT |  |
| `react-native-web` | 0.19.13 | MIT |  |
| `react-router-dom` | 6.30.4 | MIT |  |
| `socket.io-client` | 4.8.3 | MIT |  |
| `styled-components` | 6.4.1 | MIT |  |

### Dependências de desenvolvimento

| Pacote | Versão | Licença | Observação |
| --- | --- | --- | --- |
| `@eslint/js` | 9.39.4 | MIT |  |
| `@playwright/test` | 1.62.1 | Apache-2.0 |  |
| `@storybook/addon-a11y` | 9.1.20 | MIT |  |
| `@storybook/addon-docs` | 9.1.20 | MIT |  |
| `@storybook/react-vite` | 9.1.20 | MIT |  |
| `@testing-library/dom` | 10.4.1 | MIT |  |
| `@testing-library/jest-dom` | 6.9.1 | MIT |  |
| `@testing-library/react` | 16.3.2 | MIT |  |
| `@types/geojson` | 7946.0.16 | MIT |  |
| `@types/node` | 22.20.1 | MIT |  |
| `@types/react` | 18.3.28 | MIT |  |
| `@types/react-dom` | 18.3.7 | MIT |  |
| `@types/react-native` | 0.72.8 | MIT |  |
| `@typescript-eslint/eslint-plugin` | 8.59.2 | MIT |  |
| `@typescript-eslint/parser` | 8.59.2 | MIT |  |
| `@vitejs/plugin-react` | 4.7.0 | MIT |  |
| `@vitest/coverage-istanbul` | 2.1.9 | MIT |  |
| `eslint` | 9.39.4 | MIT |  |
| `eslint-plugin-react` | 7.37.5 | MIT |  |
| `eslint-plugin-react-hooks` | 5.2.0 | MIT |  |
| `globals` | 15.15.0 | MIT |  |
| `jsdom` | 25.0.1 | MIT |  |
| `prettier` | 3.8.3 | MIT |  |
| `react-native` | 0.19.13 | MIT | Instala `react-native-web` sob este nome |
| `storybook` | 9.1.20 | MIT |  |
| `typescript` | 5.9.3 | Apache-2.0 |  |
| `vite` | 5.4.21 | MIT |  |
| `vitest` | 2.1.9 | MIT |  |

## App do trabalhador (`mobile`)

### Dependências de execução

| Pacote | Versão | Licença | Observação |
| --- | --- | --- | --- |
| `@bacons/apple-targets` | 5.0.0 | MIT |  |
| `@config-plugins/react-native-webrtc` | 13.0.0 | MIT |  |
| `@expo-google-fonts/inter` | 0.4.2 | MIT AND OFL-1.1 | **Atenção: licença fora de MIT, ISC, BSD e Apache-2.0** |
| `@expo-google-fonts/montserrat` | 0.4.2 | MIT AND OFL-1.1 | **Atenção: licença fora de MIT, ISC, BSD e Apache-2.0** |
| `@expo/vector-icons` | 15.1.1 | MIT |  |
| `@kavicki/swi-design-system` | 0.1.142 | Proprietária (Kavicki) | Biblioteca própria da Kavicki |
| `@maplibre/maplibre-react-native` | 11.3.6 | MIT |  |
| `@react-navigation/native` | 7.2.4 | MIT |  |
| `@react-three/fiber` | 9.6.1 | MIT |  |
| `cep-promise` | 4.4.1 | MIT |  |
| `expo` | 54.0.37 | MIT |  |
| `expo-asset` | 12.0.13 | MIT |  |
| `expo-background-task` | 1.0.10 | MIT |  |
| `expo-build-properties` | 1.0.10 | MIT |  |
| `expo-constants` | 18.0.14 | MIT |  |
| `expo-dev-client` | 6.0.21 | MIT |  |
| `expo-document-picker` | 14.0.8 | MIT |  |
| `expo-file-system` | 19.0.24 | MIT |  |
| `expo-font` | 14.0.12 | MIT |  |
| `expo-gl` | 16.0.10 | MIT |  |
| `expo-image` | 3.0.11 | MIT |  |
| `expo-image-picker` | 17.0.11 | MIT |  |
| `expo-linking` | 8.0.12 | MIT |  |
| `expo-location` | 19.0.8 | MIT |  |
| `expo-router` | 6.0.24 | MIT |  |
| `expo-secure-store` | 15.0.8 | MIT |  |
| `expo-splash-screen` | 31.0.13 | MIT |  |
| `expo-status-bar` | 3.0.9 | MIT |  |
| `expo-task-manager` | 14.0.9 | MIT |  |
| `expo-web-browser` | 15.0.11 | MIT |  |
| `maplibre-gl` | 6.11.2 | BSD-3-Clause |  |
| `react` | 19.1.0 | MIT |  |
| `react-dom` | 19.1.0 | MIT |  |
| `react-native` | 0.81.5 | MIT |  |
| `react-native-gesture-handler` | 2.28.0 | MIT |  |
| `react-native-health-connect` | 4.1.3 | MIT |  |
| `react-native-keyboard-controller` | 1.18.5 | MIT |  |
| `react-native-reanimated` | 4.1.7 | MIT |  |
| `react-native-safe-area-context` | 5.6.2 | MIT |  |
| `react-native-screens` | 4.16.0 | MIT |  |
| `react-native-svg` | 15.12.1 | MIT |  |
| `react-native-web` | 0.21.2 | MIT |  |
| `react-native-webrtc` | 124.0.8 | MIT |  |
| `react-native-worklets` | 0.5.1 | MIT |  |
| `socket.io-client` | 4.8.3 | MIT |  |
| `three` | 0.166.1 | MIT |  |
| `three-stdlib` | 2.36.1 | MIT |  |

### Dependências de desenvolvimento

| Pacote | Versão | Licença | Observação |
| --- | --- | --- | --- |
| `@gltf-transform/core` | 4.3.0 | MIT |  |
| `@gltf-transform/functions` | 4.3.0 | MIT |  |
| `@playwright/test` | 1.62.1 | Apache-2.0 |  |
| `@types/jest` | 29.5.14 | MIT |  |
| `@types/react` | 19.1.17 | MIT |  |
| `@types/react-test-renderer` | 19.1.0 | MIT |  |
| `@types/three` | 0.166.0 | MIT |  |
| `babel-plugin-transform-import-meta` | 2.3.3 | BSD-3-Clause |  |
| `eslint` | 9.39.5 | MIT |  |
| `eslint-config-expo` | 10.0.0 | MIT |  |
| `jest` | 29.7.0 | MIT |  |
| `jest-expo` | 54.0.18 | MIT |  |
| `react-test-renderer` | 19.1.0 | MIT |  |
| `typescript` | 5.9.3 | Apache-2.0 |  |

## Licenças que pedem atenção

| Projeto | Pacote | Versão | Licença | Tipo |
| --- | --- | --- | --- | --- |
| `swi-backend` | `nodemailer` | 10.0.13 | MIT-0 | execução |
| `mobile` | `@expo-google-fonts/inter` | 0.4.2 | MIT AND OFL-1.1 | execução |
| `mobile` | `@expo-google-fonts/montserrat` | 0.4.2 | MIT AND OFL-1.1 | execução |
