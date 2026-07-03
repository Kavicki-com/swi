import { apiRequest } from './http';

// Infere content-type da extensão (default jpeg — cobre uris sem extensão do picker).
export function contentTypeFor(uri: string): string {
  return /\.png(\?|$)/i.test(uri) ? 'image/png' : 'image/jpeg';
}

// Sobe um arquivo local (file://) numa URL presigned via PUT. Retorna a key
// que o backend guarda. Fundação de mídia — o Chat (Fatia 4) reusa.
export async function uploadImage(uri: string): Promise<string> {
  const contentType = contentTypeFor(uri);
  const { url, key } = await apiRequest<{ url: string; key: string }>('/media/presign', {
    method: 'POST', body: { contentType }, auth: true,
  });
  const blob = await (await fetch(uri)).blob();
  const put = await fetch(url, { method: 'PUT', headers: { 'Content-Type': contentType }, body: blob as any });
  if (!put.ok) throw new Error(`Falha ao subir imagem (${put.status})`);
  return key;
}
