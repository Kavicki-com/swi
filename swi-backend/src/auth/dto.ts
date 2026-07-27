import { IsBoolean, IsEmail, IsIn, IsInt, IsOptional, IsString, Length, Max, Min, MinLength, ValidateNested } from 'class-validator'
import { IsCalendarDate } from '../profile/is-calendar-date'
import { Type } from 'class-transformer'
// companyId: a empresa que o usuário escolhe na tela de cadastro do app. Sem
// ele o WORKER nascia sem vínculo e ficava INVISÍVEL na fila de aprovação do
// painel, que é org-scoped — o fluxo cadastro→aprovação morria aí (QA
// 2026-07-26). Opcional pra não quebrar build antiga do app que ainda não manda.
// @IsString e não @IsUUID: nem todo id de Company é uuid (o seed usa
// 'company-seed-1', legível de propósito). A validação que importa é a
// existência no banco, feita no AuthService.signup.
// Perfil coletado NO cadastro. Até 2026-07-26 o app criava a conta primeiro e o
// wizard (dados pessoais, endereço, saúde) só rodava no modo mock — no fluxo
// real ele era PULADO, então o admin aprovava uma linha com nome e e-mail e
// nada mais. Tudo aqui é DIGITÁVEL: escolha do worker, não telemetria de
// smartband. Todos opcionais — cadastro sem perfil segue válido (build antiga
// do app, integrações, testes).
export class SignupProfileDto {
  @IsOptional() @IsString() cpf?: string
  @IsOptional() @IsString() phone?: string
  @IsOptional() @IsCalendarDate() birthDate?: string
  @IsOptional() @IsString() cep?: string
  @IsOptional() @IsString() street?: string
  @IsOptional() @IsString() number?: string
  @IsOptional() @IsString() complement?: string
  @IsOptional() @IsString() neighborhood?: string
  @IsOptional() @IsString() city?: string
  @IsOptional() @IsString() @Length(2, 2) uf?: string
  @IsOptional() @IsString() gender?: string
  @IsOptional() @IsString() bloodType?: string
  @IsOptional() @IsString() allergies?: string
  @IsOptional() @IsString() chronicConditions?: string
  @IsOptional() @IsInt() @Min(50) @Max(260) heightCm?: number
  @IsOptional() @IsInt() @Min(20) @Max(400) weightKg?: number
  @IsOptional() @IsBoolean() hasDisability?: boolean
}

export class SignupDto {
  @IsEmail() email!: string
  @MinLength(6) password!: string
  @IsString() name!: string
  @IsOptional() @IsString() companyId?: string
  @IsOptional() @ValidateNested() @Type(() => SignupProfileDto) profile?: SignupProfileDto
}
export class ConfirmDto { @IsEmail() email!: string; @IsString() code!: string }
export class LoginDto { @IsEmail() email!: string; @IsString() password!: string }
export class ForgotDto { @IsEmail() email!: string }
export class ResendDto { @IsEmail() email!: string }
export class ResetDto { @IsEmail() email!: string; @IsString() code!: string; @MinLength(6) newPassword!: string }
// QA F (2026-07-24): troca de senha autenticada (settings) — exige a atual.
export class ChangePasswordDto { @IsString() currentPassword!: string; @MinLength(6) newPassword!: string }

// Onboarding de empresa (painel). Aninhado (company/responsible) pra casar com
// o payload da SignUp.tsx e com SignupCompanyInput do service. Validação
// aninhada exige @ValidateNested + @Type (a global ValidationPipe é transform:true).
class SignupCompanyCompanyDto {
  @IsString() @MinLength(1) name!: string
  @IsString() @MinLength(1) cnpj!: string
  @IsOptional() @IsString() site?: string
  @IsString() @MinLength(1) cep!: string
  @IsString() @MinLength(1) street!: string
  @IsString() @MinLength(1) number!: string
  @IsString() @MinLength(1) neighborhood!: string
  @IsString() @MinLength(1) uf!: string
}
class SignupCompanyResponsibleDto {
  @IsString() @MinLength(1) name!: string
  @IsString() @MinLength(1) phone!: string
  @IsEmail() email!: string
  @IsIn(['owner', 'partner', 'manager', 'safety']) role!: string
}
export class SignupCompanyDto {
  @ValidateNested() @Type(() => SignupCompanyCompanyDto) company!: SignupCompanyCompanyDto
  @ValidateNested() @Type(() => SignupCompanyResponsibleDto) responsible!: SignupCompanyResponsibleDto
}
