// Seletor de DOCUMENTO pro exame clínico (laudo em PDF/TXT além de imagem).
// O useMediaPicker não serve aqui: expo-image-picker abre a galeria de fotos e
// um PDF nem aparece para escolha. O fluxo de exames mantém esta seleção
// específica por aceitar documentos além de imagens.
//
// Mesmo contrato do useMediaPicker: resolve a uri ou null (cancelado/erro),
// nunca lança — quem chama faz `if (!uri) return;` fora do try do envio.
import * as DocumentPicker from 'expo-document-picker';

// Mesma lista que o backend aceita pro prefixo exams
// (swi-backend/src/media/allowed-content-types.ts). Divergir daqui não afrouxa
// nada (quem decide é a assinatura do presign), só deixaria o usuário escolher
// um arquivo que o upload vai recusar.
const EXAM_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'text/plain'];

// Anexo de áudio ou PDF do relatório. Foto e vídeo entram pela galeria
// (useMediaPicker); aqui só o que a galeria não mostra. Os aliases x-m4a e
// x-wav são o que o Android informa para esses arquivos.
const REPORT_DOCUMENT_TYPES = [
  'audio/mpeg',
  'audio/mp4',
  'audio/x-m4a',
  'audio/wav',
  'audio/x-wav',
  'application/pdf',
];

async function pickOne(types: string[]): Promise<string | null> {
  try {
    const result = await DocumentPicker.getDocumentAsync({
      type: types,
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

export const pickExamDocument = (): Promise<string | null> => pickOne(EXAM_TYPES);
export const pickReportDocument = (): Promise<string | null> => pickOne(REPORT_DOCUMENT_TYPES);
