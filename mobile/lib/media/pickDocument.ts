// Seletor de DOCUMENTO pro exame clínico (laudo em PDF/TXT além de imagem).
// O useMediaPicker não serve aqui: expo-image-picker abre a galeria de fotos e
// um PDF nem aparece pra escolher — era a última ponta da unificação dos
// exames (2026-08-03) que ainda restringia o formato.
//
// Mesmo contrato do useMediaPicker: resolve a uri ou null (cancelado/erro),
// nunca lança — quem chama faz `if (!uri) return;` fora do try do envio.
import * as DocumentPicker from 'expo-document-picker';

// Mesma lista que o backend aceita pro prefixo exams
// (swi-backend/src/media/allowed-content-types.ts). Divergir daqui não afrouxa
// nada (quem decide é a assinatura do presign), só deixaria o usuário escolher
// um arquivo que o upload vai recusar.
const EXAM_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'text/plain'];

export async function pickExamDocument(): Promise<string | null> {
  try {
    const result = await DocumentPicker.getDocumentAsync({
      type: EXAM_TYPES,
      // Sem a cópia o Android devolve content:// e o new File(uri) do
      // expo-file-system não lida — o upload quebraria só lá.
      copyToCacheDirectory: true,
      multiple: false,
    });
    if (result.canceled) return null;
    return result.assets?.[0]?.uri ?? null;
  } catch {
    return null;
  }
}
