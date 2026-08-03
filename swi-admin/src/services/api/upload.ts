// Export como função solta (e não um objeto `uploadApi`, como auth/workOrders):
// o módulo tem uma operação só e um objeto de um membro seria cerimônia vazia.
import { ApiError, apiFetch } from './http'

// Sem `fields`: o upload é PUT presignado desde 2026-07-29 — o Cloudflare R2
// não implementa presigned POST (respondia 501 "Presigned post requests are not
// yet implemented"). Ver swi-backend/src/media/media.service.ts.
type Presign = { url: string; key: string }

// Espelha swi-backend/src/media/allowed-content-types.ts, que valida POR
// PREFIXO. Divergir daqui não afrouxa nada (quem decide de verdade é a
// assinatura do presign), só troca um erro claro no client por um 400 do
// servidor depois de escolher o arquivo.
const IMAGE_TYPES = ['image/jpeg', 'image/png']
// Laudo clínico costuma vir em PDF; txt entra a pedido do cliente.
const EXAM_TYPES = [...IMAGE_TYPES, 'application/pdf', 'text/plain']

// Espelha o teto validado pelo presign
// (swi-backend/src/media/media.service.ts). Divergir daqui só troca um erro
// claro no client por um 400 do servidor depois de escolher o arquivo.
export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024

/**
 * Sobe um anexo: presign no backend → PUT direto no storage (R2/MinIO).
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
 * Quem impõe tipo e tamanho de verdade é a assinatura do presign (content-type
 * e content-length entram nela); as checagens daqui só evitam gastar a rede com
 * arquivo que já se sabe inválido.
 *
 * Sem AbortSignal por YAGNI — a tela desta fatia não tem cancelamento. Se um
 * dia tiver, o parâmetro entra aqui e desce pro fetch do S3.
 */
export async function uploadImage(
  file: File,
  // 'avatars'/'exams' — foto de perfil e exames clínicos do settings (QA F).
  prefix: 'order' | 'chat' | 'reports' | 'avatars' | 'exams',
): Promise<string> {
  // A mensagem sai da mesma decisão que o allow/deny: em 'exams' ela precisa
  // citar PDF, senão manda o operador converter pra JPG um laudo que seria aceito.
  const isExam = prefix === 'exams'
  if (!(isExam ? EXAM_TYPES : IMAGE_TYPES).includes(file.type)) {
    throw new Error(
      isExam
        ? 'Selecione arquivos do tipo: PDF, JPG, PNG ou TXT'
        : 'Selecione arquivos do tipo: JPG ou PNG',
    )
  }
  if (file.size === 0) throw new Error('O arquivo está vazio')
  if (file.size > MAX_UPLOAD_BYTES) throw new Error('O arquivo excede o limite de 15 MB')

  // Fora do try de baixo de propósito: o apiFetch já devolve ApiError com o
  // status real do presign (401, 400...). Re-embrulhar aqui viraria tudo 0.
  // contentLength vai junto porque o servidor o inclui na ASSINATURA: o upload
  // só é aceito com exatamente esse tamanho, e o Content-Type do header precisa
  // casar com o assinado. Os dois juntos substituem a policy do POST antigo.
  const presign = await apiFetch<Presign>('/media/presign', {
    method: 'POST',
    body: JSON.stringify({ contentType: file.type, contentLength: file.size, prefix }),
  })

  let res: Response
  try {
    // Sem Authorization de propósito (quebraria a assinatura). O Content-Type,
    // ao contrário do POST multipart, é obrigatório aqui: entra na assinatura.
    res = await fetch(presign.url, {
      method: 'PUT',
      headers: { 'Content-Type': file.type },
      body: file,
    })
  } catch {
    // Request mais longo e pesado do app, rodando em rede de chão de fábrica:
    // cair no meio é o caso comum, não a exceção. Mesma semântica do http.ts —
    // status 0 = não chegou / não completou.
    throw new ApiError('Não foi possível enviar o arquivo. Verifique sua conexão.', 0)
  }

  if (!res.ok) {
    // O XML do storage traz o código exato (AccessDenied, EntityTooLarge,
    // SignatureDoesNotMatch) que separa presign vencido de assinatura violada
    // muito melhor que o status. Vale ouro na triagem; não é texto pro usuário.
    const body = await res.text().catch(() => '')
    console.error(`[upload] storage recusou o PUT (${res.status}):`, body)
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
