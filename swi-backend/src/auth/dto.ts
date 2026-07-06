import { IsEmail, IsString, MinLength } from 'class-validator'
export class SignupDto { @IsEmail() email!: string; @MinLength(6) password!: string; @IsString() name!: string }
export class ConfirmDto { @IsEmail() email!: string; @IsString() code!: string }
export class LoginDto { @IsEmail() email!: string; @IsString() password!: string }
export class ForgotDto { @IsEmail() email!: string }
export class ResendDto { @IsEmail() email!: string }
export class ResetDto { @IsEmail() email!: string; @IsString() code!: string; @MinLength(6) newPassword!: string }
