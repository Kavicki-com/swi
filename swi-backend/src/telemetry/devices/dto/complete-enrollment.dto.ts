import { IsOptional, IsString, Length, Matches } from 'class-validator'

/**
 * Corpo da conclusão do pareamento. Não existe campo de funcionário aqui de
 * propósito: o vínculo é o do enrollment, conferido contra o token. Com o
 * whitelist global, um workerId enviado à força é descartado antes do serviço.
 */
export class CompleteEnrollmentDto {
  // Opcional: o painel mostra e o administrador dita só os seis dígitos, então
  // o app conclui sem o id e o serviço acha o convite pelo código. Quem manda o
  // id continua com o caminho direto de sempre.
  @IsOptional() @IsString() enrollmentId?: string

  // Seis dígitos exatos, validado antes do serviço: assim uma tentativa
  // malformada não chega a custar um bcrypt.
  @Matches(/^\d{6}$/, { message: 'Código de pareamento inválido' }) code!: string

  // Rótulo do aparelho para o painel. Sem dado de saúde e sem identificador de
  // hardware: serve para a pessoa reconhecer qual iPhone revogar.
  @IsOptional() @IsString() @Length(1, 100) model?: string
}
