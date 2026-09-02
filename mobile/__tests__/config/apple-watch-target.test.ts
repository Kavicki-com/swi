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

  it('podspec depende do ExpoModulesCore e linka HealthKit', () => {
    const podspec = read('modules/swi-watch-control/ios/SwiWatchControl.podspec');
    expect(podspec).toContain("s.dependency 'ExpoModulesCore'");
    expect(podspec).toContain('HealthKit');
    expect(exists('modules/swi-watch-control/ios/SwiWatchControlModule.swift')).toBe(true);
  });
});
