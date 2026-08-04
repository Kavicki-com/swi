import { MailService } from './mail.service'

describe('MailService', () => {
  it('envia código de confirmação via transporte SMTP', async () => {
    const sendMail = jest.fn().mockResolvedValue({})
    const svc = new MailService({ sendMail } as any)
    await svc.sendConfirmationCode('joao@ex.com', '123456')
    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'joao@ex.com', subject: expect.stringContaining('onfirm') }),
    )
    expect(sendMail.mock.calls[0][0].text).toContain('123456')
  })

  // QA Web #9 — denúncia de mensagem do chat. O e-mail É o registro (decisão
  // 2026-08-04: sem persistência por ora), então precisa ser autossuficiente:
  // quem denunciou, quem escreveu, o texto, onde e quando — sem exigir que o
  // moderador vá caçar ids no banco.
  it('envia denúncia de mensagem com motivo, texto, autores e localização da mensagem', async () => {
    const sendMail = jest.fn().mockResolvedValue({})
    const svc = new MailService({ sendMail } as any)
    await svc.sendMessageReport('mod@ex.com', {
      reason: 'Assédio',
      text: 'ameaçou o colega',
      messageId: 'm1',
      conversationId: 'aaaa#bbbb',
      sentAt: '2026-08-04T12:00:00.000Z',
      messageBody: 'texto ofensivo',
      reporterName: 'Ana',
      reporterEmail: 'ana@ex.com',
      authorName: 'Beto',
      authorEmail: 'beto@ex.com',
    })
    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'mod@ex.com', subject: expect.stringContaining('enúncia') }),
    )
    const text = sendMail.mock.calls[0][0].text
    for (const parte of ['Assédio', 'ameaçou o colega', 'texto ofensivo', 'Ana', 'ana@ex.com', 'Beto', 'beto@ex.com', 'm1', 'aaaa#bbbb', '2026-08-04T12:00:00.000Z']) {
      expect(text).toContain(parte)
    }
  })

  // O detalhamento é opcional no QA ("caixa de texto para detalhar"); sem ele o
  // e-mail não pode sair com "undefined" no corpo.
  it('denúncia sem texto de detalhe sai sem "undefined" no corpo', async () => {
    const sendMail = jest.fn().mockResolvedValue({})
    const svc = new MailService({ sendMail } as any)
    await svc.sendMessageReport('mod@ex.com', {
      reason: 'Spam',
      messageId: 'm1',
      conversationId: 'aaaa#bbbb',
      sentAt: '2026-08-04T12:00:00.000Z',
      messageBody: 'compre já',
      reporterName: 'Ana',
      reporterEmail: 'ana@ex.com',
      authorName: 'Beto',
      authorEmail: 'beto@ex.com',
    })
    expect(sendMail.mock.calls[0][0].text).not.toContain('undefined')
  })
})
