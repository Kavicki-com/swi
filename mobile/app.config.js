// Config dinâmica do Expo. Estende o app.json (que segue sendo a fonte de
// tudo) só para apontar o google-services.json do Firebase, que o push do
// Android precisa e que NÃO entra no git: tem chave do projeto e o portão de
// segredos e a regra de entrega barram o arquivo no repositório.
//
// De onde vem o arquivo na build:
// - EAS: a variável de arquivo GOOGLE_SERVICES_JSON do projeto na Expo, que
//   chega à build como o caminho do arquivo;
// - build local: uma cópia em mobile/google-services.json (ignorada pelo git).
// Sem nenhum dos dois a build segue, sem o Firebase: o app abre, e o token de
// push não vem (o registro falha em silêncio e nada quebra).
//
// Roda no Node, como CommonJS, onde `__dirname` existe: a declaração abaixo
// só conta isso ao lint, que não sabe em que ambiente este arquivo roda.
/* global __dirname */
const fs = require('fs');
const path = require('path');

const LOCAL_FILE = 'google-services.json';

/** O caminho do google-services.json para a build, ou undefined sem ele. */
function googleServicesFile(env, exists) {
  const fromEas = (env.GOOGLE_SERVICES_JSON || '').trim();
  if (fromEas) return fromEas;
  return exists(path.join(__dirname, LOCAL_FILE)) ? `./${LOCAL_FILE}` : undefined;
}

module.exports = ({ config }) => {
  const file = googleServicesFile(process.env, fs.existsSync);
  if (!file) return config;
  return { ...config, android: { ...config.android, googleServicesFile: file } };
};

module.exports.googleServicesFile = googleServicesFile;
