// Regras de apresentação dos anexos do relatório, sem React: rótulo do tipo,
// tamanho legível e as linhas do AttachmentList do DS. Detalhe e formulário
// usam as mesmas funções, para o anexo ler igual nas duas telas.
import type { AttachmentAction, AttachmentItem, AttachmentKind } from '@kavicki/swi-design-system'
import { fileNameFromUrl } from '@/lib/attachments'
import type { ReportAttachment, ReportAttachmentKind } from '@/services/api/reports'

const KIND_LABEL: Record<ReportAttachmentKind, string> = {
  image: 'Imagem',
  video: 'Vídeo',
  audio: 'Áudio',
  document: 'PDF',
}

// O AttachmentList chama o documento de `file` (cartão com clipe).
const DS_KIND: Record<ReportAttachmentKind, AttachmentKind> = {
  image: 'image',
  video: 'video',
  audio: 'audio',
  document: 'file',
}

export const kindLabel = (kind: ReportAttachmentKind): string => KIND_LABEL[kind]
export const toAttachmentKind = (kind: ReportAttachmentKind): AttachmentKind => DS_KIND[kind]

const MB = 1024 * 1024

/** "850 KB" abaixo de 1 MB, "3,2 MB" a partir dele. Nunca "0 KB" para arquivo com conteúdo. */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 KB'
  if (bytes < MB) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / MB).toFixed(1).replace('.', ',')} MB`
}

/** Linha do anexo escolhido no formulário: "relato.m4a · Áudio · 3,2 MB". */
export function pickedDescription(name: string, kind: ReportAttachmentKind, bytes: number): string {
  return `${name} · ${KIND_LABEL[kind]} · ${formatBytes(bytes)}`
}

/**
 * Linhas do AttachmentList para anexos já gravados. O nome sai da URL (a key
 * tem a extensão, que diz o tipo e vira o nome do arquivo baixado); sem nome
 * usável, cai em "Vídeo 1", "Áudio 2", numerado por tipo. O id é a posição,
 * estável enquanto a lista não muda.
 */
export function attachmentItems(
  attachments: ReadonlyArray<ReportAttachment>,
  actions: ReadonlyArray<AttachmentAction>,
): AttachmentItem[] {
  const seen: Partial<Record<ReportAttachmentKind, number>> = {}
  return attachments.map((a, index) => {
    const n = (seen[a.kind] = (seen[a.kind] ?? 0) + 1)
    return {
      id: `att_${index}`,
      name: fileNameFromUrl(a.url) ?? `${KIND_LABEL[a.kind]} ${n}`,
      kind: DS_KIND[a.kind],
      thumbnailUri: a.kind === 'image' ? a.url : undefined,
      actions,
    }
  })
}
