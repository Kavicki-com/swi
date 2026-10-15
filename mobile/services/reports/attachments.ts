import { attachmentKindOf, contentTypeFor } from '../api/uploadMedia';
import type { ReportAttachment } from './types';

/**
 * Anexos a partir de urls soltas: o servidor antigo manda só `images`, e o
 * mock local guarda a própria uri do seletor. O tipo sai da extensão, como o
 * servidor faz com a key; sem key não há o que preservar (`key: ''`).
 */
export function attachmentsFromUrls(urls: readonly string[]): ReportAttachment[] {
  return urls.map((url) => {
    const contentType = contentTypeFor(url);
    return { key: '', url, contentType, kind: attachmentKindOf(contentType) };
  });
}
