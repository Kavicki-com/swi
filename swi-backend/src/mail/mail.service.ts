import { Injectable, Optional } from '@nestjs/common'
import * as nodemailer from 'nodemailer'

@Injectable()
export class MailService {
  private readonly from = process.env.MAIL_FROM ?? 'no-reply@swi.local'
  // transporter injetável p/ teste; default = SMTP do MailHog
  constructor(
    // @Optional(): o Nest não injeta um Transporter (não é provider) — passa undefined,
    // e o default do JS cria o transporter real do MailHog. O teste passa um mock explícito.
    // Defaults = MailHog (dev, sem auth). Com SMTP real (Resend/SendGrid),
    // setar SMTP_USER/SMTP_PASS (+ SMTP_SECURE=1 na porta 465) no .env —
    // sem essas envs o comportamento é idêntico ao de sempre.
    @Optional() private readonly transporter: nodemailer.Transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST ?? 'localhost',
      port: Number(process.env.SMTP_PORT ?? 1025),
      secure: process.env.SMTP_SECURE === '1',
      ...(process.env.SMTP_USER
        ? { auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS ?? '' } }
        : {}),
    }),
  ) {}

  async sendConfirmationCode(to: string, code: string): Promise<void> {
    await this.transporter.sendMail({
      from: this.from, to, subject: 'SWI — Confirm seu e-mail',
      text: `Seu código de confirmação é: ${code}`,
    })
  }

  async sendResetCode(to: string, code: string): Promise<void> {
    await this.transporter.sendMail({
      from: this.from, to, subject: 'SWI — Redefinição de senha',
      text: `Seu código de redefinição é: ${code}`,
    })
  }

  // Painel admin: em vez do código cru, manda o LINK clicável que já cai na
  // tela de definir/redefinir senha (código embutido na URL). Serve tanto pro
  // cadastro (senha inicial) quanto pra recuperação do admin.
  async sendAdminPasswordLink(to: string, url: string): Promise<void> {
    await this.transporter.sendMail({
      from: this.from, to, subject: 'SWI — Defina sua senha',
      text: `Para definir sua senha de acesso ao painel SWI, acesse: ${url}`,
    })
  }
}
