import fs from 'fs';
import path from 'path';

// Gate da Task 1 do piloto Apple Watch: o target watchOS e o módulo iPhone
// nascem de arquivos de configuração lidos pelo prebuild (CNG). Este teste lê
// esses arquivos reais e prende as invariantes que, se quebrarem, só seriam
// descobertas num build EAS de vinte minutos.
const root = path.resolve(__dirname, '..', '..');
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');
const exists = (rel: string) => fs.existsSync(path.join(root, rel));

const app = JSON.parse(read('app.json')).expo as {
  ios: {
    bundleIdentifier: string;
    entitlements?: Record<string, unknown>;
    infoPlist?: Record<string, unknown>;
  };
  plugins: (string | [string, unknown])[];
};

type TargetConfig = {
  type: string;
  name?: string;
  bundleIdentifier?: string;
  deploymentTarget?: string;
  icon?: string;
  frameworks?: string[];
  entitlements?: Record<string, unknown>;
};

const loadTargetConfig = (): TargetConfig => {
  const loaded = require(path.join(root, 'targets', 'watch', 'expo-target.config.js'));
  return typeof loaded === 'function' ? loaded(app) : loaded;
};

const pluginNames = app.plugins.map((p) => (Array.isArray(p) ? p[0] : p));

describe('target watchOS (targets/watch)', () => {
  it('declara um Watch App com companion, derivado do bundle id do SWI', () => {
    const target = loadTargetConfig();
    expect(target.type).toBe('watch');
    expect(target.bundleIdentifier).toBe('.watchkitapp');
    expect(`${app.ios.bundleIdentifier}${target.bundleIdentifier}`).toBe(
      'com.kavicki.swi.watchkitapp',
    );
  });

  // Sem icone a App Store Connect recusa o .ipa no processamento (erros 90713 e
  // 90391), depois de um build inteiro de EAS. O plugin gera o 1024 sem alfa.
  //
  // O plugin resolve o caminho RELATIVO A PASTA DO TARGET, nao a raiz do
  // projeto, e quando nao acha o arquivo apenas avisa e segue: o prebuild passa
  // e a App Store recusa de novo. Por isso o teste resolve do mesmo lugar.
  it('declara o ícone do relógio, sem o qual a App Store recusa o pacote', () => {
    const target = loadTargetConfig();
    expect(typeof target.icon).toBe('string');
    expect(exists(path.join('targets', 'watch', target.icon as string))).toBe(true);
  });

  it('exige watchOS 10 ou superior, mínimo do workout mirroring', () => {
    const target = loadTargetConfig();
    expect(parseFloat(target.deploymentTarget ?? '0')).toBeGreaterThanOrEqual(10);
  });

  it('tem entitlement de HealthKit e linka HealthKit e SwiftUI', () => {
    const target = loadTargetConfig();
    expect(target.entitlements?.['com.apple.developer.healthkit']).toBe(true);
    expect(target.frameworks).toEqual(expect.arrayContaining(['HealthKit', 'SwiftUI']));
  });

  it('Info.plist do relógio declara app WatchKit, workout em background e uso do HealthKit', () => {
    const plist = read('targets/watch/Info.plist');
    expect(plist).toContain('<key>WKApplication</key>');
    expect(plist).toContain('workout-processing');
    expect(plist).toContain('<key>NSHealthShareUsageDescription</key>');
    expect(plist).toContain('<key>NSHealthUpdateUsageDescription</key>');
  });

  it('inclui o app SwiftUI, a tela e o coletor com sessão espelhada', () => {
    expect(exists('targets/watch/SWIWatchApp.swift')).toBe(true);
    expect(exists('targets/watch/ContentView.swift')).toBe(true);
    const collector = read('targets/watch/WorkoutCollector.swift');
    expect(collector).toContain('HKLiveWorkoutBuilder');
    expect(collector).toContain('startMirroringToCompanionDevice');
    expect(collector).toContain('sendToRemoteWorkoutSession');
  });

  // Ativar do iPhone acorda o app do relógio, mas quem abre a sessão é o
  // delegate. Sem ele o startWatchApp acorda o app e nada acontece, e a falha
  // só apareceria com o relógio na mão.
  it('registra o delegate que recebe a sessão iniciada pelo iPhone', () => {
    const app = read('targets/watch/SWIWatchApp.swift');
    expect(app).toContain('WKApplicationDelegateAdaptor');
    expect(app).toContain('WKApplicationDelegate');
    expect(app).toContain('func handle(_ workoutConfiguration: HKWorkoutConfiguration)');
  });

  it('o coletor é único, para o delegate e a tela operarem a mesma sessão', () => {
    const collector = read('targets/watch/WorkoutCollector.swift');
    expect(collector).toContain('static let shared');
    // A configuração entregue pelo sistema é usada como veio, em vez de uma
    // recriada localmente que poderia divergir do que o iPhone pediu.
    expect(collector).toContain('func start(configuration:');
  });
});

describe('app iOS (app.json)', () => {
  it('registra o plugin que gera os targets Apple no prebuild', () => {
    expect(pluginNames).toContain('@bacons/apple-targets');
    const pkg = JSON.parse(read('package.json')) as { dependencies: Record<string, string> };
    expect(pkg.dependencies['@bacons/apple-targets']).toBeDefined();
  });

  it('tem entitlement de HealthKit e as strings de uso exigidas pela App Store', () => {
    expect(app.ios.entitlements?.['com.apple.developer.healthkit']).toBe(true);
    const share = app.ios.infoPlist?.NSHealthShareUsageDescription;
    const update = app.ios.infoPlist?.NSHealthUpdateUsageDescription;
    expect(typeof share).toBe('string');
    expect((share as string).length).toBeGreaterThan(20);
    expect(typeof update).toBe('string');
    expect((update as string).length).toBeGreaterThan(20);
  });
});

describe('módulo iPhone (modules/swi-watch-control)', () => {
  const config = () =>
    JSON.parse(read('modules/swi-watch-control/expo-module.config.json')) as {
      platforms: string[];
      apple: { modules: string[]; appDelegateSubscribers: string[] };
    };

  it('só existe na plataforma Apple e registra módulo e subscriber do AppDelegate', () => {
    const c = config();
    expect(c.platforms).toEqual(['apple']);
    expect(c.apple.modules).toContain('SwiWatchControlModule');
    expect(c.apple.appDelegateSubscribers).toContain('SwiWatchControlAppDelegateSubscriber');
  });

  it('instala o handler de sessão espelhada no launch do app', () => {
    const subscriber = read(
      'modules/swi-watch-control/ios/SwiWatchControlAppDelegateSubscriber.swift',
    );
    expect(subscriber).toContain('didFinishLaunchingWithOptions');
    const receiver = read('modules/swi-watch-control/ios/MirroredWorkoutReceiver.swift');
    expect(receiver).toContain('workoutSessionMirroringStartHandler');
    expect(receiver).toContain('didReceiveDataFromRemoteWorkoutSession');
  });

  it('expõe ativar o monitoramento como ação distinta de autorizar (ADR-0003)', () => {
    const receiver = read('modules/swi-watch-control/ios/MirroredWorkoutReceiver.swift');
    expect(receiver).toContain('startWatchApp(toHandle:');
    expect(receiver).toContain('func startMonitoring');
    const module = read('modules/swi-watch-control/ios/SwiWatchControlModule.swift');
    expect(module).toContain('AsyncFunction("startMonitoring")');
  });

  // A folha de permissão que o funcionário lê no primeiro uso é a do iPhone. Se
  // ela pedir menos do que a tela promete, o texto e o sistema se contradizem,
  // e o sistema só pergunta uma vez por tipo.
  it('iPhone pede ao HealthKit os mesmos tipos que o relógio lê', () => {
    const receiver = read('modules/swi-watch-control/ios/MirroredWorkoutReceiver.swift');
    const collector = read('targets/watch/WorkoutCollector.swift');
    for (const tipo of ['.heartRate', '.activeEnergyBurned', '.stepCount']) {
      expect(collector).toContain(`HKQuantityType(${tipo})`);
      expect(receiver).toContain(`HKQuantityType(${tipo})`);
    }
  });

  it('podspec depende do ExpoModulesCore e linka HealthKit', () => {
    const podspec = read('modules/swi-watch-control/ios/SwiWatchControl.podspec');
    expect(podspec).toContain("s.dependency 'ExpoModulesCore'");
    expect(podspec).toContain('HealthKit');
    expect(exists('modules/swi-watch-control/ios/SwiWatchControlModule.swift')).toBe(true);
  });
});
