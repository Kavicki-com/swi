import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, UnauthorizedException } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { PrismaService } from '../prisma/prisma.service'
import { UsersService } from '../users/users.service'
import { MailService } from '../mail/mail.service'
import { generateCode, hash, verifyHash, DUMMY_HASH } from './codes'

const CODE_TTL_MIN = 30

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UsersService,
    private readonly mail: MailService,
    private readonly jwt: JwtService,
  ) {}

  async signup(p: { email: string; password: string; name: string }): Promise<{ nextStep: 'CONFIRM' }> {
    if (await this.users.findByEmail(p.email)) throw new ConflictException('E-mail já cadastrado')
    const code = generateCode()
    const user = await this.prisma.user.create({
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
    try {
      await this.mail.sendConfirmationCode(p.email, code)
    } catch (err) {
      try {
        await this.prisma.user.delete({ where: { id: user.id } })   // sem órfão
      } catch (delErr) {
        this.logger.error(`falha ao reverter usuário órfão ${user.id}: ${delErr}`)
      }
      throw err
    }
    return { nextStep: 'CONFIRM' }
  }

  async confirm(p: { email: string; code: string }): Promise<void> {
    const u = await this.users.findByEmail(p.email)
    const ok = await verifyHash(p.code, u?.confirmationCodeHash ?? DUMMY_HASH)  // sempre 1 compare
    if (!u || !u.confirmationCodeHash || !u.confirmationExpires || !ok) throw new BadRequestException('Código inválido')
    if (u.confirmationExpires < new Date()) throw new BadRequestException('Código expirado')
    await this.prisma.user.update({
      where: { id: u.id },
      data: { emailVerified: true, confirmationCodeHash: null, confirmationExpires: null },
    })
  }

  async resendConfirmationCode(p: { email: string }): Promise<void> {
    const u = await this.users.findByEmail(p.email)
    const code = generateCode()
    if (!u || u.emailVerified) {
      await hash(code)   // trabalho dummy equivalente ao caminho real (1 bcrypt) → sem oráculo de enumeração/estado
      return             // silencioso: e-mail inexistente OU já confirmado (não reenvia código a quem não precisa)
    }
    await this.prisma.user.update({
      where: { id: u.id },
      data: { confirmationCodeHash: await hash(code), confirmationExpires: new Date(Date.now() + CODE_TTL_MIN * 60_000) },
    })
    await this.mail.sendConfirmationCode(p.email, code)
  }

  async login(p: { email: string; password: string }): Promise<{ accessToken: string; user: { id: string; email: string; name: string } }> {
    const u = await this.users.findByEmail(p.email)
    const ok = await verifyHash(p.password, u?.passwordHash ?? DUMMY_HASH)
    if (!u || !ok) throw new UnauthorizedException('Credenciais inválidas')
    if (!u.emailVerified) throw new ForbiddenException({ reason: 'EMAIL_NOT_VERIFIED', message: 'Confirme seu e-mail antes de entrar' })
    if (u.approvalStatus !== 'APPROVED') throw new ForbiddenException({ reason: 'NOT_APPROVED', message: 'Sua conta está aguardando aprovação do administrador' })
    return { accessToken: this.jwt.sign({ sub: u.id, role: u.role }), user: { id: u.id, email: u.email, name: u.name } }
  }

  async forgotPassword(p: { email: string }): Promise<void> {
    const u = await this.users.findByEmail(p.email)
    const code = generateCode()
    if (!u) {
      await hash(code)   // trabalho dummy equivalente ao caminho real (1 bcrypt), descartado → sem oráculo de timing
      return             // silencioso de propósito
    }
    await this.prisma.user.update({
      where: { id: u.id },
      data: { resetCodeHash: await hash(code), resetExpires: new Date(Date.now() + CODE_TTL_MIN * 60_000) },
    })
    await this.mail.sendResetCode(p.email, code)
  }

  async resetPassword(p: { email: string; code: string; newPassword: string }): Promise<void> {
    const u = await this.users.findByEmail(p.email)
    const ok = await verifyHash(p.code, u?.resetCodeHash ?? DUMMY_HASH)          // sempre 1 compare
    if (!u || !u.resetCodeHash || !u.resetExpires || !ok) throw new BadRequestException('Código inválido')
    if (u.resetExpires < new Date()) throw new BadRequestException('Código expirado')
    await this.prisma.user.update({
      where: { id: u.id },
      data: { passwordHash: await hash(p.newPassword), resetCodeHash: null, resetExpires: null },
    })
  }
}
