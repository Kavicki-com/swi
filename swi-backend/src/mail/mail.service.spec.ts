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

  // Cadastro pelo painel: a conta nasce ativa e a pessoa recebe as credenciais
  // prontas. O login vai escrito como o e-mail, porque o painel também pede um
  // nome de usuário e ele não serve para entrar.
  it('envia as credenciais do cadastro pelo painel com login (e-mail), senha e a porta de entrada', async () => {
    const sendMail = jest.fn().mockResolvedValue({})
    const svc = new MailService({ sendMail } as any)

    await svc.sendPanelCredentials('ana@ex.com', { name: 'Ana', email: 'ana@ex.com', password: 'Senha@2026' })
    const funcionaria = sendMail.mock.calls[0][0]
    expect(funcionaria).toEqual(expect.objectContaining({ to: 'ana@ex.com', subject: 'SWI: seu cadastro foi concluído' }))
    expect(funcionaria.text).toContain('Olá, Ana.')
    expect(funcionaria.text).toContain('Login (e-mail): ana@ex.com')
    expect(funcionaria.text).toContain('Senha: Senha@2026')
    expect(funcionaria.text).toContain('aplicativo SWI')
    expect(funcionaria.text).not.toContain('painel')
    expect(funcionaria.text).toContain('trocar a senha após o primeiro acesso')

    await svc.sendPanelCredentials('bia@ex.com', { name: 'Bia', email: 'bia@ex.com', password: 'Senha@2026', panelUrl: 'https://painel.teste' })
    const supervisora = sendMail.mock.calls[1][0]
    expect(supervisora.text).toContain('painel SWI em https://painel.teste')
    expect(supervisora.text).not.toContain('aplicativo')
  })

  // Denúncia de mensagem do chat. O e-mail É o registro, já que não há
  // persistência no banco, então precisa ser autossuficiente: quem denunciou,
  // quem escreveu, o texto, onde e quando, sem exigir que o moderador vá caçar
  // ids no banco.
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

  // O detalhamento é opcional, e sem ele o e-mail não pode sair com
  // "undefined" no corpo.
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
