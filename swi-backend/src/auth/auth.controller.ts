import { Body, Controller, Get, HttpCode, Post, UseGuards } from '@nestjs/common'
import { Throttle } from '@nestjs/throttler'
import { AuthService } from './auth.service'
import { UsersService } from '../users/users.service'
import { JwtAuthGuard } from './jwt-auth.guard'
import { CurrentUserId } from './current-user.decorator'
import { SignupDto, ConfirmDto, LoginDto, ForgotDto, ResetDto, ResendDto, SignupCompanyDto } from './dto'

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService, private readonly users: UsersService) {}

  @Throttle({ default: { limit: 5, ttl: 60000 } }) @Post('signup') signup(@Body() b: SignupDto) { return this.auth.signup(b) }
  @Throttle({ default: { limit: 5, ttl: 60000 } }) @Post('confirm') @HttpCode(200) confirm(@Body() b: ConfirmDto) { return this.auth.confirm(b) }
  @Throttle({ default: { limit: 5, ttl: 60000 } }) @Post('confirm/resend') @HttpCode(200) resend(@Body() b: ResendDto) { return this.auth.resendConfirmationCode(b) }
  @Throttle({ default: { limit: 10, ttl: 60000 } }) @Post('login') @HttpCode(200) login(@Body() b: LoginDto) { return this.auth.login(b) }
  @Throttle({ default: { limit: 5, ttl: 60000 } }) @Post('password/forgot') @HttpCode(200) forgot(@Body() b: ForgotDto) { return this.auth.forgotPassword(b) }
  @Throttle({ default: { limit: 5, ttl: 60000 } }) @Post('password/reset') @HttpCode(200) reset(@Body() b: ResetDto) { return this.auth.resetPassword(b) }

  // Onboarding do painel: cria empresa + admin responsável e manda link de senha.
  @Throttle({ default: { limit: 5, ttl: 60000 } }) @Post('signup-company') @HttpCode(200) signupCompany(@Body() b: SignupCompanyDto) { return this.auth.signupCompany(b) }
  // Recuperação do admin: mesmo /forgot, mas manda LINK (o /password/forgot segue code-based pro mobile).
  @Throttle({ default: { limit: 5, ttl: 60000 } }) @Post('password/forgot-admin') @HttpCode(200) forgotAdmin(@Body() b: ForgotDto) { return this.auth.forgotPasswordAdmin(b) }

  @UseGuards(JwtAuthGuard) @Get('me')
  async me(@CurrentUserId() userId: string) {
    const u = await this.users.findById(userId)
    return u ? { id: u.id, email: u.email, name: u.name } : null
  }
}
