import { Injectable, Optional } from '@nestjs/common'
import * as nodemailer from 'nodemailer'
import { parseSmtpSecure } from '../config/runtime-env'

@Injectable()
export class MailService {
  private readonly from = process.env.MAIL_FROM ?? 'no-reply@swi.local'
  // transporter injetável p/ teste; default = SMTP do MailHog
  constructor(
    // @Optional(): o Nest não injeta um Transporter (não é provider), passa undefined,
    // e o default do JS cria o transporter real do MailHog. O teste passa um mock explícito.
    // Defaults = MailHog (dev, sem auth). Com SMTP real (Resend/SendGrid),
    // setar SMTP_USER/SMTP_PASS (+ SMTP_SECURE=1 na porta 465) no .env;
    // sem essas envs o comportamento é idêntico ao de sempre.
    @Optional() private readonly transporter: nodemailer.Transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST ?? 'localhost',
      port: Number(process.env.SMTP_PORT ?? 1025),
      secure: parseSmtpSecure(process.env),
      ...(process.env.SMTP_USER
        ? { auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS ?? '' } }
        : {}),
    }),
  ) {}

  async sendConfirmationCode(to: string, code: string): Promise<void> {
    await this.transporter.sendMail({
      from: this.from, to, subject: 'SWI: confirme seu e-mail',
      text: `Seu código de confirmação é: ${code}`,
    })
  }

  async sendResetCode(to: string, code: string): Promise<void> {
    await this.transporter.sendMail({
      from: this.from, to, subject: 'SWI: redefinição de senha',
      text: `Seu código de redefinição é: ${code}`,
    })
  }

  // Painel admin: em vez do código cru, manda o LINK clicável que já cai na
  // tela de definir/redefinir senha (código embutido na URL). Serve tanto pro
  // cadastro (senha inicial) quanto pra recuperação do admin.
  async sendAdminPasswordLink(to: string, url: string): Promise<void> {
    await this.transporter.sendMail({
      from: this.from, to, subject: 'SWI: defina sua senha',
      text: `Para definir sua senha de acesso ao painel SWI, acesse: ${url}`,
    })
  }

  // Cadastro feito pelo painel: a conta já nasce ativa, então no lugar de
  // código ou link de ativação a pessoa recebe as credenciais prontas. É o
  // único momento em que a senha existe em texto; depois do hash ninguém a
  // recupera, nem para reenviar. "Login" vai escrito como o e-mail de
  // propósito: o painel também pede um nome de usuário, e ele não serve para
  // entrar.
  async sendPanelCredentials(to: string, info: PanelCredentialsInfo): Promise<void> {
    const acesso = info.panelUrl
      ? `Entre no painel SWI em ${info.panelUrl} com o login e a senha acima.`
      : 'Entre no aplicativo SWI com o login e a senha acima.'
    await this.transporter.sendMail({
      from: this.from, to, subject: 'SWI: seu cadastro foi concluído',
      text:
        `Olá, ${info.name}.\n\n` +
        `Seu cadastro no SWI foi concluído e já está ativo. Estas são as suas credenciais de acesso:\n\n` +
        `Login (e-mail): ${info.email}\n` +
        `Senha: ${info.password}\n\n` +
        `${acesso}\n\n` +
        `Recomendamos trocar a senha após o primeiro acesso, nas configurações.\n`,
    })
  }

  // Denúncia de mensagem do chat. Sem persistência no banco, este e-mail é o
  // único registro da denúncia, por isso carrega tudo que um moderador precisa
  // sem ir ao banco.
  async sendMessageReport(to: string, report: MessageReportInfo): Promise<void> {
    const detalhe = report.text?.trim() ? `\nDetalhes: ${report.text.trim()}` : ''
    await this.transporter.sendMail({
      from: this.from, to, subject: 'SWI: denúncia de mensagem no chat',
      text:
        `Uma mensagem do chat foi denunciada.\n\n` +
        `Motivo: ${report.reason}${detalhe}\n\n` +
        `Denunciada por: ${report.reporterName} (${report.reporterEmail})\n` +
        `Autor da mensagem: ${report.authorName} (${report.authorEmail})\n\n` +
        `Mensagem: ${report.messageBody}\n` +
        `Enviada em: ${report.sentAt}\n` +
        `Conversa: ${report.conversationId}\n` +
        `Id da mensagem: ${report.messageId}\n`,
    })
  }
}

export interface PanelCredentialsInfo {
  name: string
  /** O login da pessoa. Vai explícito no e-mail como "Login (e-mail)". */
  email: string
  /** Senha em texto, definida pelo admin no painel. Só existe aqui, antes do hash. */
  password: string
  /** URL do painel para quem entra por ele (administrador e supervisor); ausente para o funcionário, que entra pelo app. */
  panelUrl?: string
}

export interface MessageReportInfo {
  reason: string
  /** Detalhamento opcional (~240 chars, validado no DTO da rota). */
  text?: string
  messageId: string
  conversationId: string
  /** ISO-8601 de quando a mensagem denunciada foi enviada. */
  sentAt: string
  messageBody: string
  reporterName: string
  reporterEmail: string
  authorName: string
  authorEmail: string
}
