import { IsBoolean, IsInt, IsOptional, IsString, Length, Matches, Max, Min } from 'class-validator'
import { IsCalendarDate } from './is-calendar-date'
export class UpdateProfileDto {
  @IsOptional() @IsString() fullName?: string
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
  // QA F (2026-07-24): campos que o settings/cadastro coletavam e o whitelist
  // do ValidationPipe descartava em silêncio (sem entrada no DTO = no-op).
  @IsOptional() @IsString() sector?: string
  @IsOptional() @IsString() jobTitle?: string
  @IsOptional() @IsString() gender?: string
  @IsOptional() @IsString() bloodType?: string
  @IsOptional() @IsString() allergies?: string
  @IsOptional() @IsString() chronicConditions?: string
  @IsOptional() @IsString() managerName?: string
  @IsOptional() @IsString() duty?: string
  // Wizard de onboarding do app (step 3). Digitáveis, então persistem de
  // verdade — o combobox oferece 140-220 cm e 40-160 kg, e os limites aqui
  // são a rede pra quem chamar a API direto.
  @IsOptional() @IsInt() @Min(50) @Max(260) heightCm?: number
  @IsOptional() @IsInt() @Min(20) @Max(400) weightKg?: number
  @IsOptional() @IsBoolean() hasDisability?: boolean
  // Só keys emitidas pelo presign no namespace avatars/ — URL assinada não passa.
  @IsOptional() @Matches(/^avatars\/[0-9a-f-]{36}\.(jpg|png)$/) avatarKey?: string
  // Só keys emitidas pelo presign no namespace exams/ — URL assinada não passa.
  @IsOptional() @Matches(/^exams\/[0-9a-f-]{36}\.(jpg|png)$/, { each: true }) examKeys?: string[]
}
