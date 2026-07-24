import { IsEmail, IsIn, IsOptional, IsString, MinLength, ValidateNested } from 'class-validator'
import { Type } from 'class-transformer'
export class SignupDto { @IsEmail() email!: string; @MinLength(6) password!: string; @IsString() name!: string }
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
