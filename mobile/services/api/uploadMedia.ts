import { File } from 'expo-file-system';
import { apiRequest, withDeadline } from './http';

// Infere content-type da extensão (default jpeg, cobre uris sem extensão do picker).
export function contentTypeFor(uri: string): string {
  return /\.png(\?|$)/i.test(uri) ? 'image/png' : 'image/jpeg';
}

// Prazo do PUT no storage. Maior que o das chamadas de API (20 s) porque aqui
// trafegam até 15 MB, não um JSON pequeno: em 3G, 15 MB não cabem em 20 s.
export const UPLOAD_TIMEOUT_MS = 90_000;

/**
 * Sobe um arquivo local (file://) numa URL presignada e devolve a key que o
 * backend guarda. Fundação de mídia — Relatórios (reports/), Jornada (task/),
 * Chat (chat/), perfil (avatars/) e exames (exams/) passam o seu prefixo.
 *
 * PUT, não POST multipart: o Cloudflare R2 (storage de produção desde
 * 2026-07-29) NÃO implementa presigned POST — respondia 501 "Presigned post
 * requests are not yet implemented", e era isso que o usuário via ao anexar a
 * foto no cadastro. O MinIO local aceita os dois, então PUT serve aos dois.
 *
 * O `contentLength` vai no presign porque o servidor o inclui na ASSINATURA: o
 * upload só é aceito se o corpo tiver exatamente esse tamanho, e o Content-Type
 * do header precisa casar com o assinado (divergir em qualquer um dos dois dá
 * 403 SignatureDoesNotMatch). É o que substituiu a policy do POST.
 *
 * Os bytes são lidos pra memória porque o `fetch` do React Native não aceita
 * uma uri `file://` como corpo de PUT. Aceitável no teto de 15 MB do presign.
 */
export async function uploadImage(uri: string, prefix = 'reports'): Promise<string> {
  const contentType = contentTypeFor(uri);
  const file = new File(uri);
  // O expo devolve size 0 pra arquivo inexistente (uri de galeria que expirou,
  // por exemplo). Sem esta guarda o presign levaria 0 e voltaria 400: erro
  // certo, mensagem ruim, e uma ida à rede desperdiçada.
  if (!file.size) {
    throw new Error('Arquivo vazio ou não encontrado. Selecione a imagem novamente.');
  }
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
  // seu próprio prazo (mesmo defeito do QA Mobile #6: sem prazo, um upload que
  // trava deixa a tela girando para sempre).
  const res = await withDeadline(
    UPLOAD_TIMEOUT_MS,
    'Tempo esgotado ao enviar a imagem. Verifique sua conexão e tente novamente.',
    (signal) =>
      fetch(url, { method: 'PUT', headers: { 'Content-Type': contentType }, body, signal }),
  );
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Falha ao subir imagem (${res.status})${detail ? `: ${detail.slice(0, 200)}` : ''}`);
  }
  return key;
}
