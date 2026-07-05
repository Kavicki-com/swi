import { apiRequest } from './http';

// Infere content-type da extensão (default jpeg — cobre uris sem extensão do picker).
export function contentTypeFor(uri: string): string {
  return /\.png(\?|$)/i.test(uri) ? 'image/png' : 'image/jpeg';
}

// Sobe um arquivo local (file://) numa URL presigned via POST multipart. Retorna
// a key que o backend guarda. Fundação de mídia — Relatórios (reports/) e Jornada
// (task/) passam o prefixo; o Chat (Fatia 4) reusa com o seu.
export async function uploadImage(uri: string, prefix = 'reports'): Promise<string> {
  const contentType = contentTypeFor(uri);
  const { url, fields, key } = await apiRequest<{ url: string; fields: Record<string, string>; key: string }>(
    '/media/presign', { method: 'POST', body: { contentType, prefix }, auth: true },
  );
  const form = new FormData();
  Object.entries(fields).forEach(([k, v]) => form.append(k, v));
  // O arquivo TEM que ser o último campo (o S3 ignora campos após 'file').
  form.append('file', { uri, name: key.split('/').pop() ?? 'file', type: contentType } as any);
  // SEM header Content-Type: o RN gera o boundary do multipart/form-data.
  const res = await fetch(url, { method: 'POST', body: form as any });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Falha ao subir imagem (${res.status})${detail ? `: ${detail.slice(0, 200)}` : ''}`);
  }
  return key;
}
