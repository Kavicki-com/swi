import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator'
import { Type } from 'class-transformer'
import { MAX_UPLOAD_BYTES } from './media.service'

export class PresignDto {
  // Sem @IsIn aqui: o tipo permitido DEPENDE do prefix (ver allowed-content-types).
  // O presignPut valida e devolve 400 com a lista certa.
  @IsString() contentType!: string
  // Tamanho exato do arquivo, obrigatório porque o upload é PUT presignado (o
  // R2 não faz presigned POST) e o valor entra na assinatura: o upload só passa
  // se o corpo tiver exatamente estes bytes. O teto é este Max, e validá-lo
  // aqui devolve 400 legível em vez de um 403 opaco do storage depois de subir
  // o arquivo inteiro.
  @Type(() => Number) @IsInt() @Min(1) @Max(MAX_UPLOAD_BYTES) contentLength!: number
  // Prefixo do objeto no bucket; restrito aos domínios que sobem mídia.
  // Default 'reports'. 'task' são fotos de tarefa, 'chat' são imagens de
  // mensagem, e 'order' são anexos do WorkOrder, que o admin sobe.
  // 'exams' e 'avatars' são exames clínicos e foto de perfil, upload do próprio
  // usuário e liberado a qualquer autenticado. Só 'order' é exclusivo do ADMIN.
  @IsOptional() @IsString() @IsIn(['reports', 'task', 'chat', 'order', 'exams', 'avatars']) prefix?: string
}
