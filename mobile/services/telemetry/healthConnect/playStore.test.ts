import { Linking } from 'react-native';
import { openHealthConnectInPlayStore } from './playStore';

// A página do Health Connect na Play Store, aberta pelo pareamento e pelo
// Monitoramento quando ele falta ou pede atualização. A promessa devolvida
// termina quando as tentativas terminam, e nunca rejeita: os testes a
// aguardam em vez de esperar um tique qualquer.

const MARKET = 'market://details?id=com.google.android.apps.healthdata';
const PLAY_WEB = 'https://play.google.com/store/apps/details?id=com.google.android.apps.healthdata';

// O `Linking.openURL` do preset já é um dublê: restaurar o espião não zera os
// chamados do teste anterior.
beforeEach(() => {
  jest.clearAllMocks();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('openHealthConnectInPlayStore', () => {
  it('abre o app da Play Store pelo link do market', async () => {
    const abrir = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    await expect(openHealthConnectInPlayStore()).resolves.toBeUndefined();
    expect(abrir).toHaveBeenCalledTimes(1);
    expect(abrir).toHaveBeenCalledWith(MARKET);
  });

  it('sem o app da Play Store, abre a mesma página no navegador', async () => {
    const abrir = jest
      .spyOn(Linking, 'openURL')
      .mockRejectedValueOnce(new Error('sem quem abra'))
      .mockResolvedValue(true);
    await expect(openHealthConnectInPlayStore()).resolves.toBeUndefined();
    expect(abrir).toHaveBeenNthCalledWith(1, MARKET);
    expect(abrir).toHaveBeenNthCalledWith(2, PLAY_WEB);
  });

  // Sem nenhum dos dois não há o que fazer: nada pode escapar como rejeição
  // solta, porque quem chama é um botão.
  it('sem market e sem navegador, não rejeita', async () => {
    const abrir = jest.spyOn(Linking, 'openURL').mockRejectedValue(new Error('sem quem abra'));
    await expect(openHealthConnectInPlayStore()).resolves.toBeUndefined();
    expect(abrir).toHaveBeenCalledTimes(2);
  });
});
