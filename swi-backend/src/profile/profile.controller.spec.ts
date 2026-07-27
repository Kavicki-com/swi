import { NotFoundException } from '@nestjs/common'
import { ProfileController } from './profile.controller'

// QA F (2026-07-24): o settings do admin precisa EXIBIR a foto e os exames que
// salvou — o GET /profile/me devolve as keys cruas + URLs presignadas de view
// (padrão house: reports/users/chat presignam no read).
const profile = (over: Record<string, unknown> = {}) => ({
  id: 'p1',
  userId: 'u1',
  fullName: 'Ana',
  avatarKey: null,
  examKeys: [] as string[],
  ...over,
})

const mediaMock = () => ({
  presignGet: jest.fn(async (k: string) => `https://s3/view/${k}`),
  presignGetMany: jest.fn(async (ks: string[]) => ks.map((k) => `https://s3/view/${k}`)),
}) as any

describe('ProfileController.me', () => {
  it('enriquece com avatarUrl e examUrls presignados quando há keys', async () => {
    const svc = { getByUserId: jest.fn(async () => profile({ avatarKey: 'avatars/a.png', examKeys: ['exams/e1.jpg', 'exams/e2.png'] })), listExams: jest.fn(async () => []) } as any
    const media = mediaMock()
    const out = await new ProfileController(svc, media).me('u1')
    expect(out.avatarUrl).toBe('https://s3/view/avatars/a.png')
    expect(out.examUrls).toEqual(['https://s3/view/exams/e1.jpg', 'https://s3/view/exams/e2.png'])
    // As keys cruas continuam no payload (o form precisa delas pra mesclar exames novos).
    expect(out.avatarKey).toBe('avatars/a.png')
    expect(out.examKeys).toEqual(['exams/e1.jpg', 'exams/e2.png'])
  })

  it('sem avatarKey → avatarUrl null e nenhum presign de avatar', async () => {
    const svc = { getByUserId: jest.fn(async () => profile()), listExams: jest.fn(async () => []) } as any
    const media = mediaMock()
    const out = await new ProfileController(svc, media).me('u1')
    expect(out.avatarUrl).toBeNull()
    expect(out.examUrls).toEqual([])
    expect(media.presignGet).not.toHaveBeenCalled()
  })

  it('perfil inexistente → NotFound', async () => {
    const svc = { getByUserId: jest.fn(async () => null) } as any
    await expect(new ProfileController(svc, mediaMock()).me('u1')).rejects.toBeInstanceOf(NotFoundException)
  })
})

// O card do design exige nome + validade + download: só a key do arquivo (o
// antigo examKeys, que nunca chegou a ser preenchido) não desenha nada.
describe('ProfileController — exames', () => {
  const exam = {
    id: 'e1',
    userId: 'u1',
    name: 'Exame de reciclagem técnica',
    date: new Date('2027-03-05T00:00:00.000Z'),
    fileKey: 'exams/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.jpg',
    createdAt: new Date(0),
  }

  it('lista com data de CALENDÁRIO e URL assinada', async () => {
    const svc = { listExams: jest.fn(async () => [exam]) } as any
    const out = await new ProfileController(svc, mediaMock()).exams('u1')
    expect(out).toEqual([
      {
        id: 'e1',
        name: 'Exame de reciclagem técnica',
        // 'AAAA-MM-DD' e não ISO datetime: em fuso negativo o dia recuaria um.
        date: '2027-03-05',
        fileUrl: `https://s3/view/${exam.fileKey}`,
      },
    ])
  })

  it('cria e devolve o card já pronto pra tela', async () => {
    const svc = { addExam: jest.fn(async () => exam) } as any
    const out = await new ProfileController(svc, mediaMock()).addExam('u1', {
      name: 'Exame de reciclagem técnica',
      date: '2027-03-05',
      fileKey: exam.fileKey,
    })
    expect(svc.addExam).toHaveBeenCalledWith('u1', {
      name: 'Exame de reciclagem técnica',
      date: '2027-03-05',
      fileKey: exam.fileKey,
    })
    expect(out.date).toBe('2027-03-05')
    expect(out.fileUrl).toContain('exams/')
  })

  it('apagar exame de outra pessoa é 404, não 403 (invisível)', async () => {
    const svc = { removeExam: jest.fn(async () => false) } as any
    await expect(new ProfileController(svc, mediaMock()).removeExam('u1', 'de-outro')).rejects.toBeInstanceOf(NotFoundException)
  })

  it('apagar o próprio exame não devolve corpo', async () => {
    const svc = { removeExam: jest.fn(async () => true) } as any
    await expect(new ProfileController(svc, mediaMock()).removeExam('u1', 'e1')).resolves.toBeUndefined()
  })
})
