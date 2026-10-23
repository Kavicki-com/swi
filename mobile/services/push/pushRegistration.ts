import { Platform } from 'react-native';
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { withDeadline } from '../api/http';
import { AUTH_BACKEND } from '../../lib/featureFlags';
import { deletePushToken, sendPushToken, type PushPlatform } from './pushTokens';
import { ensureEvacuationChannel } from './evacuationChannel';

// Registro do aparelho para o push. Com a pessoa logada: o canal da
// evacuação existe (no Android 13 ou mais novo o pedido de permissão só
// aparece depois de haver um canal), a permissão é pedida se nunca foi, o
// token da Expo é obtido com o projectId do EAS e vai para POST /push/tokens.
// Negada a permissão, ou sem o Firebase na build, nada quebra: o app segue
// sabendo da evacuação pelo socket e pela consulta ao abrir.
//
// No logout a remoção vem ANTES de apagar o JWT, porque a rota exige
// autenticação, e com prazo: sem sinal, a saída não espera.

export type PushPermission = 'granted' | 'undetermined' | 'denied';

export type PushRegisterResult = 'registered' | 'denied' | 'unavailable' | 'failed';

/** Teto do logout para remover o token (Expo e API somados). */
export const PUSH_UNREGISTER_DEADLINE_MS = 4_000;

export interface PushRegistrationDeps {
  /** Null quando não há push: web, ou o login de demonstração sem a API. */
  platform: PushPlatform | null;
  ensureChannel(): Promise<void>;
  permission(): Promise<PushPermission>;
  /** Mostra o pedido do sistema. Verdadeiro se a pessoa aceitou. */
  requestPermission(): Promise<boolean>;
  /** O token da Expo; com o token novo do sistema quando ele trocou. */
  getToken(devicePushToken?: unknown): Promise<string>;
  send(token: string, platform: PushPlatform): Promise<void>;
  remove(token: string): Promise<void>;
}

export interface PushRegistration {
  register(): Promise<PushRegisterResult>;
  /** O sistema trocou o token com o app aberto: manda o novo. */
  refresh(devicePushToken: unknown): Promise<void>;
  unregister(): Promise<void>;
}

export function createPushRegistration(deps: PushRegistrationDeps): PushRegistration {
  // O último token obtido nesta execução, para a remoção do logout.
  let known: string | null = null;

  async function permission(): Promise<PushPermission> {
    try {
      return await deps.permission();
    } catch {
      return 'denied';
    }
  }

  async function sendToken(platform: PushPlatform, devicePushToken?: unknown): Promise<boolean> {
    try {
      const token =
        devicePushToken === undefined ? await deps.getToken() : await deps.getToken(devicePushToken);
      known = token;
      await deps.send(token, platform);
      return true;
    } catch {
      // Sem token (Firebase, rede da Expo) ou sem a API: a próxima abertura
      // ou o próximo login tentam de novo.
      return false;
    }
  }

  async function register(): Promise<PushRegisterResult> {
    const { platform } = deps;
    if (!platform) return 'unavailable';
    try {
      await deps.ensureChannel();
    } catch {
      // Sem o canal a notificação do início não aparece no Android, mas o
      // token ainda serve para o fim, que é só de dados.
    }
    const current = await permission();
    if (current === 'denied') return 'denied';
    if (current === 'undetermined') {
      let granted = false;
      try {
        granted = await deps.requestPermission();
      } catch {
        granted = false;
      }
      if (!granted) return 'denied';
    }
    return (await sendToken(platform)) ? 'registered' : 'failed';
  }

  async function refresh(devicePushToken: unknown): Promise<void> {
    const { platform } = deps;
    if (!platform) return;
    if ((await permission()) !== 'granted') return;
    await sendToken(platform, devicePushToken);
  }

  async function removeKnown(): Promise<void> {
    let token = known;
    if (!token) {
      if ((await permission()) !== 'granted') return;
      try {
        token = await deps.getToken();
      } catch {
        return;
      }
    }
    known = null;
    try {
      await deps.remove(token);
    } catch {
      // O logout segue. O token fica na API até outra conta registrar o mesmo
      // aparelho ou a Expo dizer que ele não vale mais.
    }
  }

  async function unregister(): Promise<void> {
    if (!deps.platform) return;
    try {
      await withDeadline(PUSH_UNREGISTER_DEADLINE_MS, 'push: remoção sem resposta', () => removeKnown());
    } catch {
      // Prazo estourado: a saída não espera mais.
    }
  }

  return { register, refresh, unregister };
}

/** O projectId do EAS, que o token da Expo precisa fora do Expo Go. */
function easProjectId(): string | undefined {
  const extra = Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined;
  return extra?.eas?.projectId ?? Constants.easConfig?.projectId;
}

function pushPlatform(): PushPlatform | null {
  if (AUTH_BACKEND !== 'api') return null;
  if (Platform.OS === 'android' || Platform.OS === 'ios') return Platform.OS;
  return null;
}

let registration: PushRegistration | null = null;

/** O registro real, um por processo. */
export function getPushRegistration(): PushRegistration {
  registration ??= createPushRegistration({
    platform: pushPlatform(),
    ensureChannel: ensureEvacuationChannel,
    async permission() {
      const current = await Notifications.getPermissionsAsync();
      if (current.granted) return 'granted';
      return current.status === Notifications.PermissionStatus.UNDETERMINED ? 'undetermined' : 'denied';
    },
    async requestPermission() {
      return (await Notifications.requestPermissionsAsync()).granted;
    },
    async getToken(devicePushToken?: unknown) {
      const options: Notifications.ExpoPushTokenOptions = { projectId: easProjectId() };
      if (devicePushToken !== undefined) {
        options.devicePushToken = devicePushToken as Notifications.DevicePushToken;
      }
      return (await Notifications.getExpoPushTokenAsync(options)).data;
    },
    send: sendPushToken,
    remove: deletePushToken,
  });
  return registration;
}

/** Logout: remove o token deste aparelho antes de apagar o JWT. Nunca lança. */
export function unregisterPush(): Promise<void> {
  return getPushRegistration().unregister();
}
