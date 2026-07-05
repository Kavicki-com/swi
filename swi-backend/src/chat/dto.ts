import { IsOptional, IsString, Matches, MaxLength } from 'class-validator'
export class SendMessageDto {
  @IsOptional() @IsString() @MaxLength(4000) body?: string
  @IsOptional() @IsString()
  @Matches(/^chat\/[0-9a-f-]{36}\.(jpg|png)$/, { message: 'imageKey inválida' })
  imageKey?: string
}
