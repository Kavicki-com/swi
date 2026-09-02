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
  frameworks: ['SwiftUI', 'HealthKit'],
  entitlements: {
    'com.apple.developer.healthkit': true,
  },
};
