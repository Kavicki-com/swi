import { IsIn, IsOptional, IsString } from 'class-validator'

export class PresignDto {
  @IsString() @IsIn(['image/jpeg', 'image/png']) contentType!: string
  // Prefixo do objeto no bucket; restrito aos domínios que sobem mídia.
  // Default 'reports' (Fatia 2); 'task' entra na Fatia 3 (fotos de tarefa);
  // 'chat' entra na Fatia 4 (imagens de mensagem).
  @IsOptional() @IsString() @IsIn(['reports', 'task', 'chat']) prefix?: string
}
