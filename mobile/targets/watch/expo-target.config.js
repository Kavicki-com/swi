// Target watchOS do SWI, gerado no prebuild por @bacons/apple-targets.
// Task 1 do piloto: app descartavel que prova HealthKit, HKWorkoutSession e
// workout mirroring no fluxo EAS/TestFlight. Fonte de verdade e este arquivo
// mais os Swift desta pasta; a pasta ios/ gerada nao e versionada.
/** @type {import('@bacons/apple-targets/app.plugin').Config} */
module.exports = {
  type: 'watch',
  name: 'SWIWatch',
  displayName: 'SWI',
  // Prefixo "." concatena ao bundle id do app: com.kavicki.swi.watchkitapp.
  bundleIdentifier: '.watchkitapp',
  // Workout mirroring (startMirroringToCompanionDevice) exige watchOS 10.
  deploymentTarget: '10.0',
  // O mesmo icone do app iOS. O plugin gera o 1024x1024 do relogio sem canal
  // alfa e com fundo branco, como a App Store exige. Sem este campo o .ipa
  // compila, sobe, e e recusado no processamento (erros 90713 e 90391).
  //
  // Caminho RELATIVO A ESTA PASTA, nao a raiz do mobile. Com caminho errado o
  // plugin so avisa ("Skipping icon generation") e o prebuild passa.
  icon: '../../assets/images/icon.png',
  frameworks: ['SwiftUI', 'HealthKit'],
  entitlements: {
    'com.apple.developer.healthkit': true,
  },
};
