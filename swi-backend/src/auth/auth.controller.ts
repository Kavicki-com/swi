import { Body, Controller, Get, HttpCode, Post, Req, UseGuards } from '@nestjs/common'
import { Throttle } from '@nestjs/throttler'
import { AuthService } from './auth.service'
import { UsersService } from '../users/users.service'
import { JwtAuthGuard } from './jwt-auth.guard'
import { SignupDto, ConfirmDto, LoginDto, ForgotDto, ResetDto } from './dto'

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService, private readonly users: UsersService) {}

  @Throttle({ default: { limit: 5, ttl: 60000 } }) @Post('signup') signup(@Body() b: SignupDto) { return this.auth.signup(b) }
  @Throttle({ default: { limit: 5, ttl: 60000 } }) @Post('confirm') @HttpCode(200) confirm(@Body() b: ConfirmDto) { return this.auth.confirm(b) }
  @Throttle({ default: { limit: 10, ttl: 60000 } }) @Post('login') @HttpCode(200) login(@Body() b: LoginDto) { return this.auth.login(b) }
  @Throttle({ default: { limit: 5, ttl: 60000 } }) @Post('password/forgot') @HttpCode(200) forgot(@Body() b: ForgotDto) { return this.auth.forgotPassword(b) }
  @Throttle({ default: { limit: 5, ttl: 60000 } }) @Post('password/reset') @HttpCode(200) reset(@Body() b: ResetDto) { return this.auth.resetPassword(b) }

  @UseGuards(JwtAuthGuard) @Get('me')
  async me(@Req() req: any) {
    const u = await this.users.findById(req.user.userId)
    return u ? { id: u.id, email: u.email, name: u.name } : null
  }
}
