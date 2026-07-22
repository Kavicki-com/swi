import { IsBoolean, IsEmail, IsIn, IsISO8601, IsNotEmpty, IsOptional, IsString, MinLength } from 'class-validator'

// Cadastro de usuário pelo painel (ADMIN). Senha definida pelo admin (mín. 8);
// role restrito a WORKER/ADMIN. Campos de identidade opcionais vão pro Profile.
export class CreateUserDto {
  @IsString() @IsNotEmpty() name!: string
  @IsEmail() email!: string
  @IsString() @MinLength(8) password!: string
  @IsIn(['WORKER', 'ADMIN']) role!: 'WORKER' | 'ADMIN'
  @IsOptional() @IsString() phone?: string
  @IsOptional() @IsString() cpf?: string
  @IsOptional() @IsISO8601() birthDate?: string
}

// Ativar/desativar usuário pelo painel (ADMIN). Corpo do PATCH /users/:id.
export class SetActiveDto {
  @IsBoolean() active!: boolean
}
