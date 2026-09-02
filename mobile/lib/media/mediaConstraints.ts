// Formatos e limites de upload num módulo só (ticket 17), espelhando o backend:
// extensões seguem swi-backend/src/media/allowed-content-types.ts (por prefixo)
// e o teto segue MAX_UPLOAD_BYTES do media.service. A FONTE DE VERDADE é a
// assinatura do presign lá; este módulo é o feedback imediato no aparelho,
// antes de qualquer ida à rede.
//
// A lista multimídia final (vídeo? áudio?) ainda é decisão do cliente, por
// escrito no plano da U01. Estender é acrescentar a extensão aqui e o
// content-type no módulo do backend; nada mais consulta lista própria.

export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024; // 15 MB, o mesmo teto do presign

export const IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png'] as const;
// Exame clínico aceita laudo em PDF; txt entrou a pedido do cliente.
export const EXAM_EXTENSIONS = [...IMAGE_EXTENSIONS, 'pdf', 'txt'] as const;

export type MediaKind = 'image' | 'exam';

export interface PickedMedia {
  uri: string;
  /** Tamanho em bytes quando o picker informa; ausente, o teto fica pro upload. */
  size?: number | null;
}

export type MediaValidation = { ok: true } | { ok: false; reason: string };

// Extensão da uri, tolerante a query string; '' quando não há (câmera e alguns
// pickers devolvem uri sem extensão: o upload assina como jpeg e segue).
function extensionOf(uri: string): string {
  const path = uri.split('?')[0];
  const dot = path.lastIndexOf('.');
  const slash = path.lastIndexOf('/');
  return dot > slash ? path.slice(dot + 1).toLowerCase() : '';
}

/**
 * Valida o arquivo que o picker devolveu ANTES de entrar no formulário.
 * Recusa explica em uma frase o que vale, com a mesma régua do servidor;
 * o desconhecido (sem extensão, sem tamanho) passa, porque recusá-lo aqui
 * quebraria fluxos que o backend aceita, e a régua real continua lá.
 */
export function validatePickedMedia(media: PickedMedia, kind: MediaKind = 'image'): MediaValidation {
  const allowed: readonly string[] = kind === 'exam' ? EXAM_EXTENSIONS : IMAGE_EXTENSIONS;
  const ext = extensionOf(media.uri);
  if (ext && !allowed.includes(ext)) {
    return {
      ok: false,
      reason:
        kind === 'exam'
          ? 'Formato não suportado. Envie arquivos JPG, PNG, PDF ou TXT.'
          : 'Formato não suportado. Envie arquivos JPG ou PNG.',
    };
  }
  if (media.size != null && media.size > MAX_UPLOAD_BYTES) {
    return { ok: false, reason: 'Arquivo muito grande. O limite é 15 MB.' };
  }
  return { ok: true };
}
