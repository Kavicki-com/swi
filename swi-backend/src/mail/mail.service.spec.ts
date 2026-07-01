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
})
