import fs from 'fs';
import path from 'path';

// A transmissão ao vivo usa a câmera e passa pelo plugin do react-native-webrtc,
// que sempre grava permissões. Os textos e os bloqueios só chegam ao aparelho
// pelo prebuild; este teste prende o app.json para que nada disso dependa de
// uma build para ser descoberto.
const root = path.resolve(__dirname, '..', '..');
const app = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8')).expo as {
  ios: { infoPlist: Record<string, unknown> };
  android: { blockedPermissions?: string[] };
  plugins: (string | [string, Record<string, unknown>])[];
};

const CAMERA_TEXT =
  'Permite tirar fotos para anexar a tarefas e relatórios e, quando você liga a câmera na tela inicial, transmitir a imagem ao vivo para os administradores da sua empresa.';
const MICROPHONE_TEXT = 'O SWI não usa o microfone. A transmissão ao vivo da câmera é só de imagem.';

const pluginOptions = (name: string) => {
  const entry = app.plugins.find((p) => (Array.isArray(p) ? p[0] : p) === name);
  return Array.isArray(entry) ? entry[1] : undefined;
};

describe('permissões da câmera ao vivo (app.json)', () => {
  it('o plugin do WebRTC está declarado com os textos em português', () => {
    expect(pluginOptions('@config-plugins/react-native-webrtc')).toEqual({
      cameraPermission: CAMERA_TEXT,
      microphonePermission: MICROPHONE_TEXT,
    });
  });

  it('o texto da câmera é o mesmo no Info.plist e no seletor de fotos', () => {
    expect(app.ios.infoPlist.NSCameraUsageDescription).toBe(CAMERA_TEXT);
    expect(pluginOptions('expo-image-picker')?.cameraPermission).toBe(CAMERA_TEXT);
  });

  it('o Android não leva o microfone nem a janela sobre outros apps', () => {
    expect(app.android.blockedPermissions).toEqual(
      expect.arrayContaining(['android.permission.RECORD_AUDIO', 'android.permission.SYSTEM_ALERT_WINDOW']),
    );
  });
});
