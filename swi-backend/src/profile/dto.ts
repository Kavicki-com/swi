import { IsOptional, IsString, Length } from 'class-validator'
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
}
