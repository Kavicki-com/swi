import * as SecureStore from 'expo-secure-store';
import { isBandGuideId, type BandGuideId } from './bandGuide';

// A resposta a "Qual é o app da sua pulseira?". Fica só neste aparelho, por
// usuário, e serve só para escolher o guia: não vai ao backend e não diz
// nada sobre a pulseira que o app não viu (spec, Descoberta da marca).
//
// Vive no SecureStore porque é a única persistência do app (ver
// watchOnboarding.ts). Não é segredo; é só onde o app guarda coisas.

const PREFIXO = 'swi.bandGuide.answer.v1.';

// O SecureStore só aceita letras, números, ".", "-" e "_" na chave.
const chaveDe = (userId: string) => `${PREFIXO}${userId.replace(/[^A-Za-z0-9._-]/g, '_')}`;

/** Ausência, falha de leitura e valor desconhecido dão no mesmo: perguntar de novo. */
export async function readBandGuideAnswer(userId: string): Promise<BandGuideId | null> {
  try {
    const bruto = await SecureStore.getItemAsync(chaveDe(userId));
    return bruto !== null && isBandGuideId(bruto) ? bruto : null;
  } catch {
    return null;
  }
}

export async function saveBandGuideAnswer(userId: string, answer: BandGuideId): Promise<void> {
  try {
    await SecureStore.setItemAsync(chaveDe(userId), answer);
  } catch {
    // Perder a resposta só repete a pergunta; o guia já está na tela.
  }
}
