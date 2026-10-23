import fs from 'fs';
import path from 'path';

// O push só chega ao aparelho pelo que o prebuild grava: o plugin do
// expo-notifications (com o modo remote-notification no iPhone, para o fim da
// evacuação acordar o app) e o google-services.json do Firebase no Android.
// O arquivo do Firebase não entra no git; o app.config.js aponta para ele na
// build. Este teste prende as duas coisas sem precisar de uma build.
const root = path.resolve(__dirname, '..', '..');
const appJson = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8')).expo as {
  android: { permissions: string[]; googleServicesFile?: string; package: string };
  plugins: (string | [string, Record<string, unknown>])[];
};
const appConfig = require('../../app.config.js') as {
  (ctx: { config: typeof appJson }): typeof appJson;
  googleServicesFile(env: Record<string, string | undefined>, exists: (file: string) => boolean): string | undefined;
};

const pluginOptions = (name: string) => {
  const entry = appJson.plugins.find((p) => (Array.isArray(p) ? p[0] : p) === name);
  return Array.isArray(entry) ? entry[1] : entry;
};

describe('push no app.json', () => {
  it('o plugin do expo-notifications liga as notificações remotas em segundo plano no iPhone', () => {
    expect(pluginOptions('expo-notifications')).toEqual(
      expect.objectContaining({ enableBackgroundRemoteNotifications: true }),
    );
  });

  it('o Android pede a permissão de notificação (13 ou mais novo)', () => {
    expect(appJson.android.permissions).toContain('android.permission.POST_NOTIFICATIONS');
  });

  it('o app.json não aponta para o arquivo do Firebase: quem aponta é o app.config.js', () => {
    expect(appJson.android.googleServicesFile).toBeUndefined();
  });
});

describe('google-services.json fora do git', () => {
  it('o .gitignore do app ignora o arquivo', () => {
    const ignore = fs.readFileSync(path.join(root, '.gitignore'), 'utf8').split(/\r?\n/);
    expect(ignore).toContain('google-services.json');
  });

  it('a variável de arquivo do EAS tem a vez', () => {
    const found = appConfig.googleServicesFile({ GOOGLE_SERVICES_JSON: '/tmp/eas/gs.json' }, () => true);
    expect(found).toBe('/tmp/eas/gs.json');
  });

  it('sem a variável, usa a cópia local na pasta do app se existir', () => {
    const exists = jest.fn((file: string) => file === path.join(root, 'google-services.json'));
    expect(appConfig.googleServicesFile({}, exists)).toBe('./google-services.json');
  });

  it('variável vazia vale como ausente', () => {
    expect(appConfig.googleServicesFile({ GOOGLE_SERVICES_JSON: '  ' }, () => false)).toBeUndefined();
  });

  it('sem nenhum dos dois, a build segue sem o Firebase', () => {
    expect(appConfig.googleServicesFile({}, () => false)).toBeUndefined();
  });

  it('o app.config.js estende o app.json sem mudar o resto', () => {
    const original = process.env.GOOGLE_SERVICES_JSON;
    process.env.GOOGLE_SERVICES_JSON = '/tmp/eas/gs.json';
    try {
      const config = appConfig({ config: appJson });
      expect(config.android.googleServicesFile).toBe('/tmp/eas/gs.json');
      expect(config.android.package).toBe(appJson.android.package);
      expect(config.plugins).toBe(appJson.plugins);
    } finally {
      if (original === undefined) delete process.env.GOOGLE_SERVICES_JSON;
      else process.env.GOOGLE_SERVICES_JSON = original;
    }
  });

  it('sem o arquivo, a config sai igual ao app.json', () => {
    const original = process.env.GOOGLE_SERVICES_JSON;
    delete process.env.GOOGLE_SERVICES_JSON;
    const local = fs.existsSync(path.join(root, 'google-services.json'));
    try {
      const config = appConfig({ config: appJson });
      if (local) expect(config.android.googleServicesFile).toBe('./google-services.json');
      else expect(config).toBe(appJson);
    } finally {
      if (original !== undefined) process.env.GOOGLE_SERVICES_JSON = original;
    }
  });
});
