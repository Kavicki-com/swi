import { BadRequestException, ConflictException, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { PrismaService } from '../prisma/prisma.service'
import { UsersService } from '../users/users.service'
import { MailService } from '../mail/mail.service'
import { generateCode, hash, verifyHash } from './codes'

const CODE_TTL_MIN = 30

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UsersService,
    private readonly mail: MailService,
    private readonly jwt: JwtService,
  ) {}

  async signup(p: { email: string; password: string; name: string }): Promise<{ nextStep: 'CONFIRM' }> {
    if (await this.users.findByEmail(p.email)) throw new ConflictException('E-mail já cadastrado')
    const code = generateCode()
    await this.prisma.user.create({
      data: {
        email: p.email,
        name: p.name,
        passwordHash: await hash(p.password),
        role: 'WORKER',
        emailVerified: false,
        approvalStatus: 'PENDING',
        confirmationCodeHash: await hash(code),
        confirmationExpires: new Date(Date.now() + CODE_TTL_MIN * 60_000),
      },
    })
    await this.mail.sendConfirmationCode(p.email, code)
    return { nextStep: 'CONFIRM' }
  }

  async confirm(p: { email: string; code: string }): Promise<void> {
    const u = await this.users.findByEmail(p.email)
    if (!u || !u.confirmationCodeHash || !u.confirmationExpires) throw new BadRequestException('Código inválido')
    if (u.confirmationExpires < new Date()) throw new BadRequestException('Código expirado')
    if (!(await verifyHash(p.code, u.confirmationCodeHash))) throw new BadRequestException('Código inválido')
    await this.prisma.user.update({
      where: { id: u.id },
      data: { emailVerified: true, confirmationCodeHash: null, confirmationExpires: null },
    })
  }

  async login(p: { email: string; password: string }): Promise<{ accessToken: string; user: { id: string; email: string; name: string } }> {
    const u = await this.users.findByEmail(p.email)
    if (!u || !(await verifyHash(p.password, u.passwordHash))) throw new UnauthorizedException('Credenciais inválidas')
    if (!u.emailVerified) throw new ForbiddenException({ reason: 'EMAIL_NOT_VERIFIED', message: 'Confirme seu e-mail antes de entrar' })
    if (u.approvalStatus !== 'APPROVED') throw new ForbiddenException({ reason: 'NOT_APPROVED', message: 'Sua conta está aguardando aprovação do administrador' })
    return { accessToken: this.jwt.sign({ sub: u.id, role: u.role }), user: { id: u.id, email: u.email, name: u.name } }
  }
}
