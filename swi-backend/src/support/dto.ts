import { IsEmail, IsOptional, IsString, MaxLength, MinLength } from 'class-validator'

// Espelha o modal "Solicitação de suporte" (motivo do dropdown + título +
// mensagem). email opcional: na tela de login não há sessão — é o único
// canal de resposta possível.
export class CreateSupportRequestDto {
  @IsString() @MinLength(1) @MaxLength(120) reason!: string
  @IsString() @MinLength(1) @MaxLength(200) title!: string
  @IsString() @MinLength(1) @MaxLength(4000) message!: string
  @IsOptional() @IsEmail() email?: string
}
