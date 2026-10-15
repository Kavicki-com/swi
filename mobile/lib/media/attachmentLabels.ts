// Rótulos do anexo multimídia do relatório, sem React: tipo em português,
// tamanho legível, ícone do DS e títulos numerados por tipo. Os mesmos textos
// do painel (swi-admin/src/pages/reports/reportAttachments.ts), para o anexo
// ler igual nos dois lugares.
import type { IconName } from '@kavicki/swi-design-system';
import type { ReportAttachment, ReportAttachmentKind } from '../../services/reports/types';

const KIND_LABEL: Record<ReportAttachmentKind, string> = {
  image: 'Imagem',
  video: 'Vídeo',
  audio: 'Áudio',
  document: 'PDF',
};

// Os mesmos glifos da miniatura do AttachmentList do DS.
const KIND_ICON: Record<ReportAttachmentKind, IconName> = {
  image: 'attach_file',
  video: 'videocam',
  audio: 'audio_file',
  document: 'attach_file',
};

export const kindLabel = (kind: ReportAttachmentKind): string => KIND_LABEL[kind];
export const attachmentIcon = (kind: ReportAttachmentKind): IconName => KIND_ICON[kind];

const MB = 1024 * 1024;

/** "850 KB" abaixo de 1 MB, "3,2 MB" a partir dele. Nunca "0 KB" para arquivo com conteúdo. */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 KB';
  if (bytes < MB) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / MB).toFixed(1).replace('.', ',')} MB`;
}

/** "Vídeo 1", "Áudio 1", "Vídeo 2": o nome original não existe (a key é um uuid). */
export function attachmentTitles(attachments: readonly ReportAttachment[]): string[] {
  const seen: Partial<Record<ReportAttachmentKind, number>> = {};
  return attachments.map((a) => {
    const n = (seen[a.kind] = (seen[a.kind] ?? 0) + 1);
    return `${KIND_LABEL[a.kind]} ${n}`;
  });
}
