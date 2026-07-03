import { IsOptional, IsString, Matches } from 'class-validator'
export class SendMessageDto {
  @IsOptional() @IsString() body?: string
  @IsOptional() @IsString()
  @Matches(/^chat\/[0-9a-f-]{36}\.(jpg|png)$/, { message: 'imageKey inválida' })
  imageKey?: string
}
