// Tipos aceitos POR PREFIXO. Antes o PresignDto validava contentType com um
// @IsIn global: liberar pdf pra exame liberaria pdf pra chat, tarefa, ordem e
// avatar. Nenhum deles conseguiria ANEXAR o arquivo (cada consumidor valida a
// própria key contra `.(jpg|png)`), mas o presign assinaria a URL e o arquivo
// subiria pro bucket, órfão: lixo de storage e vetor de abuso.
export const IMAGE_TYPES = ['image/jpeg', 'image/png'] as const

// Exame clínico costuma vir em PDF; txt entra a pedido do cliente.
export const EXAM_TYPES = [...IMAGE_TYPES, 'application/pdf', 'text/plain'] as const

// União literal de TODO tipo que o presign pode aceitar. EXAM_TYPES já é
// superset de IMAGE_TYPES, então basta ele. Existe pra que quem consome um
// content-type validado (hoje o mapa de extensões do MediaService) seja
// obrigado pelo compilador a cobrir a lista inteira, em vez de depender de
// alguém lembrar de espelhar a mudança nos dois lugares.
export type AllowedContentType = (typeof EXAM_TYPES)[number]

// Mesmo default do presignPut: prefix ausente significa 'reports'.
const DEFAULT_PREFIX = 'reports'

// Exportada porque a mensagem do 400 no presignPut lista os tipos aceitos: sair
// da MESMA fonte que decide o allow/deny é o que impede a mensagem de mentir
// quando esta lista mudar.
export function allowedTypesFor(prefix?: string): readonly string[] {
  return (prefix ?? DEFAULT_PREFIX) === 'exams' ? EXAM_TYPES : IMAGE_TYPES
}

export function isContentTypeAllowed(contentType: string, prefix?: string): boolean {
  // Comparação exata, sem normalizar parâmetro (`; charset=...`): o content-type
  // entra na ASSINATURA do presign, então aceitar aqui uma variante que seria
  // assinada diferente trocaria um 400 legível por um 403 opaco do storage,
  // depois de o upload inteiro ter subido.
  return allowedTypesFor(prefix).includes(contentType)
}
