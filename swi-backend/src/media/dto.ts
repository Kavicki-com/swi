import { IsIn, IsOptional, IsString } from 'class-validator'

export class PresignDto {
  @IsString() @IsIn(['image/jpeg', 'image/png']) contentType!: string
  // Prefixo do objeto no bucket; restrito aos domínios que sobem mídia.
  // Default 'reports' (Fatia 2); 'task' entra na Fatia 3 (fotos de tarefa);
  // 'chat' entra na Fatia 4 (imagens de mensagem); 'order' = anexos do WorkOrder
  // (admin sobe attachments da ordem de serviço).
  // exams/avatars (QA F 2026-07-24): exames clínicos e foto de perfil — upload
  // do próprio usuário, qualquer autenticado (só 'order' é ADMIN-only).
  @IsOptional() @IsString() @IsIn(['reports', 'task', 'chat', 'order', 'exams', 'avatars']) prefix?: string
}
