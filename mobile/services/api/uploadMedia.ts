import { File } from 'expo-file-system';
import { apiRequest, withDeadline } from './http';

// Espelha swi-backend/src/media/allowed-content-types.ts. Divergir daqui não
// afrouxa nada (quem decide é a assinatura do presign), só troca uma recusa
// legível no aparelho por um 400 do servidor depois de escolher o arquivo.
//
// Content-type por extensão. O seletor e a câmera sempre devolvem uri com
// extensão; sem ela cai em jpeg, que é o que a câmera entrega. pdf/txt entram
// pelo fluxo de exames; vídeo, áudio e pdf, pelo anexo do relatório.
const CONTENT_TYPE_BY_EXT: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  pdf: 'application/pdf',
  txt: 'text/plain',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  wav: 'audio/wav',
};

// Caminho de volta: a cópia da fila de envios é nomeada por esta extensão, e é
// dela que o upload deduz o content-type de novo. Desconhecido vira jpg, como
// sempre foi.
const EXT_BY_CONTENT_TYPE: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'application/pdf': 'pdf',
  'text/plain': 'txt',
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
};

/** Extensão da uri em minúsculas, '' quando não há (uri da câmera). */
function extensionOf(uri: string): string {
  const path = uri.split('?')[0] ?? uri;
  const dot = path.lastIndexOf('.');
  const slash = path.lastIndexOf('/');
  return dot > slash ? path.slice(dot + 1).toLowerCase() : '';
}

export function contentTypeFor(uri: string): string {
  return CONTENT_TYPE_BY_EXT[extensionOf(uri)] ?? 'image/jpeg';
}

export function extensionFor(contentType: string): string {
  return EXT_BY_CONTENT_TYPE[contentType] ?? 'jpg';
}

// Tetos do presign (MAX_UPLOAD_BYTES e os tetos de vídeo e áudio do backend).
export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;
export const MAX_VIDEO_BYTES = 100 * 1024 * 1024;
export const MAX_AUDIO_BYTES = 25 * 1024 * 1024;

export type ReportAttachmentKind = 'image' | 'video' | 'audio' | 'document';

export function attachmentKindOf(contentType: string): ReportAttachmentKind {
  if (contentType.startsWith('image/')) return 'image';
  if (contentType.startsWith('video/')) return 'video';
  if (contentType.startsWith('audio/')) return 'audio';
  return 'document';
}

export function maxBytesFor(contentType: string): number {
  const kind = attachmentKindOf(contentType);
  if (kind === 'video') return MAX_VIDEO_BYTES;
  if (kind === 'audio') return MAX_AUDIO_BYTES;
  return MAX_UPLOAD_BYTES;
}

// Nome do tipo na frase de recusa. PDF é PDF; outro documento (txt de exame)
// é "documento".
function kindName(contentType: string): string {
  const kind = attachmentKindOf(contentType);
  if (kind === 'image') return 'imagem';
  if (kind === 'video') return 'vídeo';
  if (kind === 'audio') return 'áudio';
  return contentType === 'application/pdf' ? 'PDF' : 'documento';
}

/** Motivo da recusa por tamanho, ou null. Mesma frase do painel. */
export function sizeLimitError(contentType: string, size: number): string | null {
  const max = maxBytesFor(contentType);
  if (size <= max) return null;
  return `O arquivo excede o limite de ${max / (1024 * 1024)} MB para ${kindName(contentType)}.`;
}

// O que o relatório aceita: imagem, vídeo, áudio e PDF. txt fica no exame.
const REPORT_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'video/mp4',
  'video/quicktime',
  'audio/mpeg',
  'audio/mp4',
  'audio/wav',
  'application/pdf',
]);

// Mesma frase do painel (swi-admin/src/services/api/upload.ts).
export const REPORT_TYPE_ERROR =
  'Tipo de arquivo não aceito. Selecione JPG, PNG, MP4, MOV, MP3, M4A, WAV ou PDF.';

/** Content-type e tipo do anexo pela uri; null quando o relatório não aceita. */
export function reportAttachmentInfo(
  uri: string,
): { contentType: string; kind: ReportAttachmentKind } | null {
  // Extensão desconhecida (.exe) não vira jpeg: o padrão de jpeg é só para a
  // uri SEM extensão, que é a da câmera.
  const ext = extensionOf(uri);
  if (ext !== '' && !CONTENT_TYPE_BY_EXT[ext]) return null;
  const contentType = contentTypeFor(uri);
  return REPORT_TYPES.has(contentType)
    ? { contentType, kind: attachmentKindOf(contentType) }
    : null;
}

/**
 * Motivo da recusa do anexo de relatório, ou null quando passa. `size` null
 * quando a tela não conseguiu ler o arquivo: aí só o tipo é checado, e a fila
 * de envios refaz a conta com o tamanho real na entrada.
 */
export function checkReportAttachment(uri: string, size: number | null): string | null {
  const info = reportAttachmentInfo(uri);
  if (!info) return REPORT_TYPE_ERROR;
  return size === null ? null : sizeLimitError(info.contentType, size);
}

// Prazo do PUT no storage. Maior que o das chamadas de API (20 s) porque aqui
// trafegam megabytes, não um JSON pequeno: em 3G, 15 MB não cabem em 20 s.
export const UPLOAD_TIMEOUT_MS = 90_000;
const UPLOAD_TIMEOUT_MAX_MS = 600_000;
const UPLOAD_MS_PER_MB = 10_000;

/**
 * O prazo cresce com o arquivo: 90 s bastam para uma foto, não para um vídeo
 * de 100 MB em 4G. Teto de 10 min para não pendurar a tela para sempre.
 */
export function uploadTimeoutFor(size: number): number {
  const porTamanho = Math.ceil(size / (1024 * 1024)) * UPLOAD_MS_PER_MB;
  return Math.min(UPLOAD_TIMEOUT_MAX_MS, Math.max(UPLOAD_TIMEOUT_MS, porTamanho));
}

/**
 * Sobe um arquivo local (file://) numa URL presignada e devolve a key que o
 * backend guarda. Fundação de mídia — Relatórios (reports/), Jornada (task/),
 * Chat (chat/), perfil (avatars/) e exames (exams/) passam o seu prefixo. O
 * nome ficou `uploadImage` por histórico: no relatório sobe vídeo, áudio e PDF
 * também.
 *
 * Usa PUT, não POST multipart, porque o Cloudflare R2 não implementa presigned
 * POST. O MinIO local aceita os dois, então PUT serve aos dois.
 *
 * O `contentLength` vai no presign porque o servidor o inclui na ASSINATURA: o
 * upload só é aceito se o corpo tiver exatamente esse tamanho, e o Content-Type
 * do header precisa casar com o assinado (divergir em qualquer um dos dois dá
 * 403 SignatureDoesNotMatch). É o que substituiu a policy do POST.
 *
 * Os bytes são lidos pra memória porque o `fetch` do React Native não aceita
 * uma uri `file://` como corpo de PUT. Com vídeo de até 100 MB isso pesa num
 * aparelho modesto; trocar por envio em stream é melhoria para depois da
 * entrega.
 */
export async function uploadImage(uri: string, prefix = 'reports'): Promise<string> {
  const contentType = contentTypeFor(uri);
  const file = new File(uri);
  // O expo devolve size 0 pra arquivo inexistente (uri de galeria que expirou,
  // por exemplo). Sem esta guarda o presign levaria 0 e voltaria 400: erro
  // certo, mensagem ruim, e uma ida à rede desperdiçada.
  if (!file.size) {
    // O código distingue esta falha das de rede: a fila de envios descarta o
    // item em vez de tentar de novo um arquivo que não existe mais.
    throw Object.assign(new Error('Arquivo vazio ou não encontrado. Selecione a imagem novamente.'), {
      code: 'FILE_MISSING',
    });
  }
  // Teto do tipo, o mesmo do presign: recusar aqui poupa a rede e dá a frase
  // certa em vez do 400.
  const refused = sizeLimitError(contentType, file.size);
  if (refused) throw new Error(refused);
  const { url, key } = await apiRequest<{ url: string; key: string }>('/media/presign', {
    method: 'POST',
    body: { contentType, contentLength: file.size, prefix },
    auth: true,
  });
  const body = await file.arrayBuffer();
  // Content-Type explícito e idêntico ao assinado: aqui, ao contrário do POST
  // multipart, ele é obrigatório, faz parte da assinatura.
  //
  // Este PUT vai direto no storage e NÃO passa pelo apiRequest, então precisa do
  // seu próprio prazo para não manter a tela em espera indefinidamente.
  const res = await withDeadline(
    uploadTimeoutFor(file.size),
    'Tempo esgotado ao enviar o arquivo. Verifique sua conexão e tente novamente.',
    (signal) =>
      fetch(url, { method: 'PUT', headers: { 'Content-Type': contentType }, body, signal }),
  );
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Falha ao subir o arquivo (${res.status})${detail ? `: ${detail.slice(0, 200)}` : ''}`);
  }
  return key;
}
