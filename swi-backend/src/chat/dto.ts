import { IsNotEmpty, IsOptional, IsString, Matches, MaxLength } from 'class-validator'
import { Transform } from 'class-transformer'
export class SendMessageDto {
  @IsOptional() @IsString() @MaxLength(4000) body?: string
  @IsOptional() @IsString()
  @Matches(/^chat\/[0-9a-f-]{36}\.(jpg|png)$/, { message: 'imageKey inválida' })
  imageKey?: string
}

// QA Web #4 — editar mensagem. Aqui o body é OBRIGATÓRIO, ao contrário do
// envio: mensagem só com imagem existe, mas editar para vazio seria exclusão
// disfarçada, sem lápide e sem trilha. O trim vem antes da validação para que
// "   " caia no IsNotEmpty em vez de passar como texto válido.
export class EditMessageDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty({ message: 'Mensagem vazia' })
  @MaxLength(4000)
  body!: string
}

// QA Web #9 — denunciar mensagem. O motivo vem de uma lista fixa do painel,
// mas o backend valida só formato e tamanho: a lista é do cliente e amarrar
// os literais aqui obrigaria deploy casado a cada motivo novo. O detalhe é a
// "caixa de ~240 caracteres" da planilha — opcional, e trim antes da validação
// pra "   " não passar como detalhe.
export class ReportMessageDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty({ message: 'Motivo obrigatório' })
  @MaxLength(80)
  reason!: string

  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsOptional()
  @IsString()
  @MaxLength(240)
  text?: string
}
