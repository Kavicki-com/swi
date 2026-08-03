import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator'
import { Type } from 'class-transformer'
import { MAX_UPLOAD_BYTES } from './media.service'

export class PresignDto {
  // Sem @IsIn aqui: o tipo permitido DEPENDE do prefix (ver allowed-content-types).
  // O presignPut valida e devolve 400 com a lista certa.
  @IsString() contentType!: string
  // Tamanho exato do arquivo, obrigatório desde a migração POST → PUT
  // (2026-07-29, o R2 não faz presigned POST): ele entra na assinatura, então o
  // upload só passa se o corpo tiver exatamente estes bytes. Antes o teto vinha
  // da policy do POST; agora é este Max — validar aqui devolve 400 legível em
  // vez de um 403 opaco do storage depois de subir o arquivo inteiro.
  @Type(() => Number) @IsInt() @Min(1) @Max(MAX_UPLOAD_BYTES) contentLength!: number
  // Prefixo do objeto no bucket; restrito aos domínios que sobem mídia.
  // Default 'reports' (Fatia 2); 'task' entra na Fatia 3 (fotos de tarefa);
  // 'chat' entra na Fatia 4 (imagens de mensagem); 'order' = anexos do WorkOrder
  // (admin sobe attachments da ordem de serviço).
  // exams/avatars (QA F 2026-07-24): exames clínicos e foto de perfil — upload
  // do próprio usuário, qualquer autenticado (só 'order' é ADMIN-only).
  @IsOptional() @IsString() @IsIn(['reports', 'task', 'chat', 'order', 'exams', 'avatars']) prefix?: string
}
