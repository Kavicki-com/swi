// Tipos aceitos POR PREFIXO. Antes o PresignDto validava contentType com um
// @IsIn global: liberar pdf pra exame liberaria pdf pra chat, tarefa, ordem e
// avatar. Nenhum deles conseguiria ANEXAR o arquivo (cada consumidor valida a
// própria key contra `.(jpg|png)`), mas o presign assinaria a URL e o arquivo
// subiria pro bucket, órfão: lixo de storage e vetor de abuso.
export const IMAGE_TYPES = ['image/jpeg', 'image/png'] as const

// Exame clínico costuma vir em PDF; txt entra a pedido do cliente.
export const EXAM_TYPES = [...IMAGE_TYPES, 'application/pdf', 'text/plain'] as const

// Anexo multimídia do relatório (Anexo I do contrato). Os aliases `x-m4a` e
// `x-wav` existem porque é o que o navegador e o Android informam para esses
// arquivos: o content-type entra na assinatura do presign, então recusar o
// alias obrigaria cada cliente a reescrever o tipo antes do PUT.
export const VIDEO_TYPES = ['video/mp4', 'video/quicktime'] as const
export const AUDIO_TYPES = ['audio/mpeg', 'audio/mp4', 'audio/x-m4a', 'audio/wav', 'audio/x-wav'] as const
export const REPORT_TYPES = [...IMAGE_TYPES, ...VIDEO_TYPES, ...AUDIO_TYPES, 'application/pdf'] as const

// União literal de TODO tipo que o presign pode aceitar. Existe pra que quem
// consome um content-type validado (o mapa de extensões logo abaixo) seja
// obrigado pelo compilador a cobrir a lista inteira, em vez de depender de
// alguém lembrar de espelhar a mudança nos dois lugares.
export type AllowedContentType = (typeof EXAM_TYPES)[number] | (typeof REPORT_TYPES)[number]

// Mesmo default do presignPut: prefix ausente significa 'reports'.
const DEFAULT_PREFIX = 'reports'

// Exportada porque a mensagem do 400 no presignPut lista os tipos aceitos: sair
// da MESMA fonte que decide o allow/deny é o que impede a mensagem de mentir
// quando esta lista mudar.
export function allowedTypesFor(prefix?: string): readonly string[] {
  const p = prefix ?? DEFAULT_PREFIX
  if (p === 'exams') return EXAM_TYPES
  if (p === 'reports') return REPORT_TYPES
  return IMAGE_TYPES
}

export function isContentTypeAllowed(contentType: string, prefix?: string): boolean {
  // Comparação exata, sem normalizar parâmetro (`; charset=...`): o content-type
  // entra na ASSINATURA do presign, então aceitar aqui uma variante que seria
  // assinada diferente trocaria um 400 legível por um 403 opaco do storage,
  // depois de o upload inteiro ter subido.
  return allowedTypesFor(prefix).includes(contentType)
}

// Tetos de upload. Imagem e documento ficam nos 15 MB de sempre. Vídeo e áudio
// têm teto próprio porque um minuto de vídeo de celular já passa de 15 MB.
// O upload é PUT presignado direto no R2 (não atravessa a API nem o proxy da
// hospedagem), e o R2 aceita até 5 GB num PUT único: quem limita é este teto.
export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024
export const MAX_VIDEO_BYTES = 100 * 1024 * 1024
export const MAX_AUDIO_BYTES = 25 * 1024 * 1024
// Maior teto de qualquer tipo: é o @Max do DTO, a faixa que o Swagger publica.
export const MAX_ANY_UPLOAD_BYTES = MAX_VIDEO_BYTES

export function maxBytesFor(contentType: string): number {
  if ((VIDEO_TYPES as readonly string[]).includes(contentType)) return MAX_VIDEO_BYTES
  if ((AUDIO_TYPES as readonly string[]).includes(contentType)) return MAX_AUDIO_BYTES
  return MAX_UPLOAD_BYTES
}

// Extensão por content-type. A chave é a união literal acima, então acrescentar
// um tipo aceito sem mapear a extensão aqui vira ERRO DE COMPILAÇÃO, não arquivo
// gravado sob nome errado em silêncio: foi assim que o PDF virava .jpg antes.
//
// O `Record<string, string>` da interseção não afrouxa nada disso: ele só
// permite a CONSULTA por uma string qualquer (a que chega do cliente), enquanto
// o `Record<AllowedContentType, string>` continua exigindo a união inteira na
// declaração. Sem ele, indexar com string seria erro de tipo e a alternativa
// seria um cast, que devolveria em silêncio o que este mapa existe pra impedir.
const EXT_BY_CONTENT_TYPE: Record<string, string> & Record<AllowedContentType, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'application/pdf': 'pdf',
  'text/plain': 'txt',
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
}

// O `?? 'jpg'` só mantém a função total pra uma string arbitrária, caso alguém
// a chame sem passar pela guarda do presign. Esquecer de mapear um tipo aceito
// é pego pelo Record acima, em tempo de compilação.
export function extensionFor(contentType: string): string {
  return EXT_BY_CONTENT_TYPE[contentType] ?? 'jpg'
}

// Caminho de volta: o banco guarda só a key, então o tipo que a leitura devolve
// sai da extensão. Cada extensão volta no nome CANÔNICO (audio/mp4, audio/wav),
// não no alias com que subiu: é o canônico que o player do painel e do app
// entende.
const CONTENT_TYPE_BY_EXT: Record<string, string> = {
  jpg: 'image/jpeg',
  png: 'image/png',
  pdf: 'application/pdf',
  txt: 'text/plain',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  wav: 'audio/wav',
}

export function contentTypeOfKey(key: string): string {
  const dot = key.lastIndexOf('.')
  const ext = dot >= 0 ? key.slice(dot + 1).toLowerCase() : ''
  return CONTENT_TYPE_BY_EXT[ext] ?? 'application/octet-stream'
}

// Como o cliente deve renderizar o anexo. Tipo desconhecido vira 'document'
// (cartão de abrir e baixar), que nunca quebra a tela.
export type AttachmentKind = 'image' | 'video' | 'audio' | 'document'

export function attachmentKindOf(contentType: string): AttachmentKind {
  if (contentType.startsWith('image/')) return 'image'
  if (contentType.startsWith('video/')) return 'video'
  if (contentType.startsWith('audio/')) return 'audio'
  return 'document'
}
