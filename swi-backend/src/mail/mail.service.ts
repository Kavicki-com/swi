import { Injectable } from '@nestjs/common'
import * as nodemailer from 'nodemailer'

@Injectable()
export class MailService {
  private readonly from = process.env.MAIL_FROM ?? 'no-reply@swi.local'
  // transporter injetável p/ teste; default = SMTP do MailHog
  constructor(
    private readonly transporter: nodemailer.Transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST ?? 'localhost',
      port: Number(process.env.SMTP_PORT ?? 1025),
      secure: false,
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
}
