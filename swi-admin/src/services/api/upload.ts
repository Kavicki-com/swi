// Export como função solta (e não um objeto `uploadApi`, como auth/workOrders):
// o módulo tem uma operação só e um objeto de um membro seria cerimônia vazia.
import { ApiError, apiFetch } from './http'

// Sem `fields`: o upload é PUT presignado porque o Cloudflare R2 não implementa
// presigned POST (responde 501 "Presigned post requests are not yet
// implemented"). Ver swi-backend/src/media/media.service.ts.
type Presign = { url: string; key: string }

// Espelha swi-backend/src/media/allowed-content-types.ts, que valida POR
// PREFIXO. Divergir daqui não afrouxa nada (quem decide de verdade é a
// assinatura do presign), só troca um erro claro no client por um 400 do
// servidor depois de escolher o arquivo.
const IMAGE_TYPES = ['image/jpeg', 'image/png']
// Laudo clínico costuma vir em PDF; txt entra a pedido do cliente.
const EXAM_TYPES = [...IMAGE_TYPES, 'application/pdf', 'text/plain']

// Espelha o teto validado pelo presign
// (swi-backend/src/media/allowed-content-types.ts). Divergir daqui só troca um
// erro claro no client por um 400 do servidor depois de escolher o arquivo.
export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024
// Anexo multimídia do relatório: vídeo e áudio têm teto próprio no backend.
export const MAX_VIDEO_BYTES = 100 * 1024 * 1024
export const MAX_AUDIO_BYTES = 25 * 1024 * 1024

export type ReportFileKind = 'image' | 'video' | 'audio' | 'document'

// Tipos aceitos em 'reports', com o tipo de anexo de cada um. Os aliases
// x-m4a e x-wav são o que o navegador costuma informar para esses arquivos, e
// o backend aceita os dois nomes.
const REPORT_KIND_BY_TYPE: Record<string, ReportFileKind> = {
  'image/jpeg': 'image',
  'image/png': 'image',
  'video/mp4': 'video',
  'video/quicktime': 'video',
  'audio/mpeg': 'audio',
  'audio/mp4': 'audio',
  'audio/x-m4a': 'audio',
  'audio/wav': 'audio',
  'audio/x-wav': 'audio',
  'application/pdf': 'document',
}

// Quando o navegador não reconhece a extensão, `file.type` vem vazio; quando
// a reconhece por outro nome (`audio/vnd.wave` para .wav), vem fora da lista.
// Nos dois casos a extensão decide, senão um .wav legítimo seria recusado.
const REPORT_TYPE_BY_EXT: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  wav: 'audio/wav',
  pdf: 'application/pdf',
}

const REPORT_MAX_BYTES: Record<ReportFileKind, number> = {
  image: MAX_UPLOAD_BYTES,
  document: MAX_UPLOAD_BYTES,
  video: MAX_VIDEO_BYTES,
  audio: MAX_AUDIO_BYTES,
}

const REPORT_KIND_NAME: Record<ReportFileKind, string> = {
  image: 'imagem',
  document: 'PDF',
  video: 'vídeo',
  audio: 'áudio',
}

// Mesmas frases do app (mobile/app/(app)/reports/new.tsx): o operador lê a
// mesma recusa nos dois lugares.
export const REPORT_TYPE_ERROR =
  'Tipo de arquivo não aceito. Selecione JPG, PNG, MP4, MOV, MP3, M4A, WAV ou PDF.'

/** Content-type que vai pro presign e o tipo de anexo; null se o relatório não aceita. */
export function reportFileInfo(file: File): { contentType: string; kind: ReportFileKind } | null {
  const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
  const contentType = REPORT_KIND_BY_TYPE[file.type] ? file.type : (REPORT_TYPE_BY_EXT[ext] ?? '')
  const kind = REPORT_KIND_BY_TYPE[contentType]
  return kind ? { contentType, kind } : null
}

/** Motivo da recusa do arquivo no relatório, ou null quando ele passa. */
export function checkReportFile(file: File): string | null {
  const info = reportFileInfo(file)
  if (!info) return REPORT_TYPE_ERROR
  if (file.size === 0) return 'O arquivo está vazio'
  const max = REPORT_MAX_BYTES[info.kind]
  if (file.size > max) {
    return `O arquivo excede o limite de ${max / (1024 * 1024)} MB para ${REPORT_KIND_NAME[info.kind]}.`
  }
  return null
}

/**
 * Sobe um anexo: presign no backend → PUT direto no storage (R2/MinIO).
 * Devolve a key. O `prefix` decide o namespace da key ('order' para anexo de
 * tarefa, que vai em `WorkOrderInput.imageKeys`; 'chat' para anexo de mensagem,
 * validado pelo controller contra chat/<uuid>.(jpg|png); 'reports' para anexo
 * de relatório, que aceita imagem, vídeo, áudio e PDF (ver checkReportFile).
 * O nome ficou `uploadImage` por histórico: no relatório ele sobe qualquer
 * anexo multimídia.
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
  // 'avatars'/'exams': foto de perfil e exames clínicos do settings.
  prefix: 'order' | 'chat' | 'reports' | 'avatars' | 'exams',
): Promise<string> {
  // Relatório tem regra própria: anexo multimídia com teto por tipo, e o
  // content-type pode sair da extensão quando o navegador não o informa.
  let contentType = file.type
  if (prefix === 'reports') {
    const refused = checkReportFile(file)
    if (refused) throw new Error(refused)
    contentType = reportFileInfo(file)?.contentType ?? file.type
  } else {
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
  }

  // Fora do try de baixo de propósito: o apiFetch já devolve ApiError com o
  // status real do presign (401, 400...). Re-embrulhar aqui viraria tudo 0.
  // contentLength vai junto porque o servidor o inclui na ASSINATURA: o upload
  // só é aceito com exatamente esse tamanho, e o Content-Type do header precisa
  // casar com o assinado. Os dois juntos substituem a policy do POST antigo.
  const presign = await apiFetch<Presign>('/media/presign', {
    method: 'POST',
    body: JSON.stringify({ contentType, contentLength: file.size, prefix }),
  })

  let res: Response
  try {
    // Sem Authorization de propósito (quebraria a assinatura). O Content-Type,
    // ao contrário do POST multipart, é obrigatório aqui: entra na assinatura.
    res = await fetch(presign.url, {
      method: 'PUT',
      headers: { 'Content-Type': contentType },
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
