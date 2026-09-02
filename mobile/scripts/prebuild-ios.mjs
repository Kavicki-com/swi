// Gera o projeto Xcode localmente para conferir o target watchOS ANTES de
// gastar um build no EAS.
//
// `npx expo prebuild --platform ios` recusa rodar no Windows: @expo/cli tem um
// `if (process.platform === 'win32')` em resolveOptions.ensureValidPlatforms
// que remove o iOS da lista e aborta. A maquinaria que copia o template e roda
// os config plugins não depende do sistema, então este script chama as três
// etapas direto, pulando só esse portão de plataforma.
//
// Uso: node scripts/prebuild-ios.mjs
//
// A pasta ios/ é ignorada pelo git e serve só para inspeção. No Windows o
// caminho do Info.plist do target sai com barra invertida ("../targets\watch/
// Info.plist"), artefato do path.join local; o EAS regenera tudo em Linux, onde
// o caminho sai correto. Não use a pasta gerada aqui como fonte de verdade.
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const require = createRequire(import.meta.url);

const cli = path.join(
  projectRoot,
  'node_modules/expo/node_modules/@expo/cli/build/src/prebuild',
);
const { ensureConfigAsync } = require(path.join(cli, 'ensureConfigAsync.js'));
const { updateFromTemplateAsync } = require(path.join(cli, 'updateFromTemplate.js'));
const { configureProjectAsync } = require(path.join(cli, 'configureProjectAsync.js'));

const pkgPath = path.join(projectRoot, 'package.json');
const pkgBackup = fs.readFileSync(pkgPath, 'utf8');

// O prebuild alinha dependências do template com o package.json. Aqui ele é só
// verificação, então o manifesto do repo volta exatamente como estava.
function restorePackageJson() {
  if (fs.readFileSync(pkgPath, 'utf8') !== pkgBackup) {
    fs.writeFileSync(pkgPath, pkgBackup);
    console.log('package.json foi tocado pelo prebuild e foi restaurado');
  }
}

async function main() {
  process.chdir(projectRoot);
  const platforms = ['ios'];

  const { exp, pkg } = await ensureConfigAsync(projectRoot, { platforms });
  console.log(`[1/3] config: ${exp.name} (${exp.ios.bundleIdentifier})`);

  const { templateChecksum, hasNewProjectFiles } = await updateFromTemplateAsync(projectRoot, {
    exp,
    pkg,
    platforms,
    skipDependencyUpdate: [],
  });
  console.log(`[2/3] template aplicado (arquivos novos: ${hasNewProjectFiles})`);

  await configureProjectAsync(projectRoot, { platforms, exp, templateChecksum });
  console.log('[3/3] config plugins e mods executados');
}

main()
  .then(() => {
    restorePackageJson();
    console.log('OK: inspecione ios/SWI.xcodeproj/project.pbxproj');
  })
  .catch((error) => {
    restorePackageJson();
    console.error(`FALHOU: ${error?.message ?? error}`);
    console.error(error?.stack);
    process.exit(1);
  });
