// Export como função solta (e não um objeto `uploadApi`, como auth/workOrders):
// o módulo tem uma operação só e um objeto de um membro seria cerimônia vazia.
import { ApiError, apiFetch } from './http'

type Presign = { url: string; fields: Record<string, string>; key: string }

const ALLOWED = ['image/jpeg', 'image/png']

// Espelha o content-length-range da policy do presign
// (swi-backend/src/media/media.service.ts). Divergir daqui só troca um erro
// claro no client por um 400 opaco do S3 depois de subir o arquivo inteiro.
export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024

/**
 * Sobe um anexo: presign no backend → POST multipart direto no S3/MinIO.
 * Devolve a key. O `prefix` decide o namespace da key ('order' para anexo de
 * tarefa, que vai em `WorkOrderInput.imageKeys`; 'chat' para anexo de mensagem,
 * validado pelo controller contra chat/<uuid>.(jpg|png); 'reports' para anexo
 * de relatório, validado contra reports/<uuid>.(jpg|png) — é o prefixo default
 * do presign, então o backend já o aceita sem mudança).
 *
 * CHAME NO SUBMIT DO FORM, NUNCA NO SELECT DO ARQUIVO: o presign vale 300 s
 * (UPLOAD_TTL em media.service.ts). Subir na hora que o usuário escolhe a foto
 * e só depois deixá-lo preencher o resto do form faz um form preenchido devagar
 * estourar o TTL e falhar com 403.
 *
 * Quem impõe tipo e tamanho de verdade é a policy do presign; as checagens
 * daqui só evitam gastar a rede com arquivo que já se sabe inválido.
 *
 * Sem AbortSignal por YAGNI — a tela desta fatia não tem cancelamento. Se um
 * dia tiver, o parâmetro entra aqui e desce pro fetch do S3.
 */
export async function uploadImage(
  file: File,
  prefix: 'order' | 'chat' | 'reports',
): Promise<string> {
  if (!ALLOWED.includes(file.type)) throw new Error('Selecione arquivos do tipo: JPG ou PNG')
  if (file.size === 0) throw new Error('O arquivo está vazio')
  if (file.size > MAX_UPLOAD_BYTES) throw new Error('O arquivo excede o limite de 15 MB')

  // Fora do try de baixo de propósito: o apiFetch já devolve ApiError com o
  // status real do presign (401, 400...). Re-embrulhar aqui viraria tudo 0.
  const presign = await apiFetch<Presign>('/media/presign', {
    method: 'POST',
    body: JSON.stringify({ contentType: file.type, prefix }),
  })

  // Sem headers de propósito: Authorization quebraria a assinatura do S3 e um
  // Content-Type manual impediria o browser de gerar o boundary do multipart.
  const form = new FormData()
  for (const [k, v] of Object.entries(presign.fields)) form.append(k, v)
  form.append('file', file) // por último — requisito do S3 POST

  let res: Response
  try {
    res = await fetch(presign.url, { method: 'POST', body: form })
  } catch {
    // Request mais longo e pesado do app, rodando em rede de chão de fábrica:
    // cair no meio é o caso comum, não a exceção. Mesma semântica do http.ts —
    // status 0 = não chegou / não completou.
    throw new ApiError('Não foi possível enviar o arquivo. Verifique sua conexão.', 0)
  }

  if (!res.ok) {
    // O XML do S3 traz o código exato (AccessDenied, EntityTooLarge,
    // SignatureDoesNotMatch) que separa presign vencido de policy violada muito
    // melhor que o status. Vale ouro na triagem; não é texto pro usuário.
    const body = await res.text().catch(() => '')
    console.error(`[upload] S3 recusou o POST (${res.status}):`, body)
    // Status fica no .status pro log/suporte; a mensagem é acionável pro
    // operador. Tipo e tamanho já foram barrados acima, então 403 em produção é
    // quase sempre o TTL de 300 s vencido.
    throw new ApiError(
      res.status === 403
        ? 'O link de envio expirou. Selecione o arquivo novamente.'
        : 'Não foi possível enviar o arquivo. Tente novamente.',
      res.status,
    )
  }
  return presign.key
}

// Wrapper fino pro anexo de tarefa — mantém os callers de work-order intactos.
export const uploadOrderImage = (file: File): Promise<string> => uploadImage(file, 'order')
