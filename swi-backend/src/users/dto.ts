import { IsBoolean, IsEmail, IsIn, IsInt, IsNotEmpty, IsOptional, IsString, Length, Matches, Max, Min, MinLength, ValidateIf } from 'class-validator'
import { IsCalendarDate } from '../profile/is-calendar-date'

// Handle visível (@username no chat e no perfil). Formato fechado JÁ, antes do
// consumidor de login da fase 2: minúsculas, dígitos, ponto e underscore, 3-30.
// Um handle com espaço ou maiúscula gravado hoje viraria, amanhã, uma conta em
// que não se consegue logar.
const USERNAME_RE = /^[a-z0-9._]{3,30}$/


// Cadastro de usuário pelo painel (ADMIN). Senha definida pelo admin (mín. 8);
// role restrito a WORKER/ADMIN. Campos de identidade opcionais vão pro Profile,
// junto dos dados de saúde declaratórios que o formulário renderiza: sem eles
// aqui, a whitelist do ValidationPipe os descartava e o cadastro jogava fora o
// que a pessoa digitou.
//
// birthDate valida como DATA DE CALENDÁRIO (paridade com o UpdateProfileDto):
// IsISO8601 aceita datetime com fuso, que desloca o dia no @db.Date.
export class CreateUserDto {
  @IsString() @IsNotEmpty() name!: string
  @IsEmail() email!: string
  @IsString() @MinLength(8) password!: string
  @IsIn(['WORKER', 'ADMIN']) role!: 'WORKER' | 'ADMIN'
  @IsOptional() @IsString() phone?: string
  @IsOptional() @IsString() cpf?: string
  @IsOptional() @IsCalendarDate() birthDate?: string
  @IsOptional() @Matches(USERNAME_RE, { message: 'username: use minúsculas, dígitos, ponto ou underscore (3 a 30)' }) username?: string
  @IsOptional() @IsString() gender?: string
  @IsOptional() @IsString() bloodType?: string
  @IsOptional() @IsString() allergies?: string
  @IsOptional() @IsString() chronicConditions?: string
}

/**
 * Corpo do PATCH /users/:id (ADMIN). Tudo opcional: é um patch, e omitir um
 * campo significa "não mexe", nunca "apaga".
 *
 * `name` e `active` usam @ValidateIf em vez de @IsOptional de propósito:
 * @IsOptional pula a validação para null (não só para undefined), e null
 * atravessando até uma coluna não-anulável do Prisma vira 500 onde cabia 400.
 * Nos campos de Profile o null é legítimo (coluna anulável, limpa o valor).
 *
 * As réguas de perfil espelham o UpdateProfileDto (IsCalendarDate, Max 260):
 * dois DTOs escrevendo na mesma tabela com limites diferentes fariam o painel
 * salvar o que o settings do worker rejeita.
 *
 * `email` e `role` estão FORA de propósito. O ValidationPipe global roda com
 * whitelist, então esses campos são removidos do corpo antes de chegar ao
 * service: e-mail é a identidade de login (trocar exige reconfirmação) e papel
 * é autorização (promover alguém a ADMIN não pode ser efeito colateral de um
 * formulário de cadastro).
 */
export class UpdateUserDto {
  @ValidateIf((o: UpdateUserDto) => o.active !== undefined) @IsBoolean() active?: boolean
  @ValidateIf((o: UpdateUserDto) => o.name !== undefined) @IsString() @IsNotEmpty() name?: string
  // @ValidateIf e não @IsOptional: null explícito precisa REPROVAR (limpar o
  // handle fica pra quando existir UI disso), e @IsOptional o deixaria passar.
  @ValidateIf((o: UpdateUserDto) => o.username !== undefined) @Matches(USERNAME_RE, { message: 'username: use minúsculas, dígitos, ponto ou underscore (3 a 30)' }) username?: string
  @IsOptional() @IsString() phone?: string
  @IsOptional() @IsString() cpf?: string
  @IsOptional() @IsCalendarDate() birthDate?: string
  @IsOptional() @IsString() cep?: string
  @IsOptional() @IsString() street?: string
  @IsOptional() @IsString() number?: string
  @IsOptional() @IsString() complement?: string
  @IsOptional() @IsString() neighborhood?: string
  @IsOptional() @IsString() city?: string
  @IsOptional() @IsString() @Length(2, 2) uf?: string
  @IsOptional() @IsString() sector?: string
  @IsOptional() @IsString() jobTitle?: string
  @IsOptional() @IsString() duty?: string
  // Dados de saúde DECLARATÓRIOS do cadastro (digitados, não medidos). A
  // telemetria da smartband não passa por aqui.
  @IsOptional() @IsString() gender?: string
  @IsOptional() @IsString() bloodType?: string
  @IsOptional() @IsString() allergies?: string
  @IsOptional() @IsString() chronicConditions?: string
  @IsOptional() @IsString() managerName?: string
  @IsOptional() @IsInt() @Min(50) @Max(260) heightCm?: number
  @IsOptional() @IsInt() @Min(20) @Max(400) weightKg?: number
  @IsOptional() @IsBoolean() hasDisability?: boolean
}
