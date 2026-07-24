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
    const svc = { getByUserId: jest.fn(async () => profile({ avatarKey: 'avatars/a.png', examKeys: ['exams/e1.jpg', 'exams/e2.png'] })) } as any
    const media = mediaMock()
    const out = await new ProfileController(svc, media).me('u1')
    expect(out.avatarUrl).toBe('https://s3/view/avatars/a.png')
    expect(out.examUrls).toEqual(['https://s3/view/exams/e1.jpg', 'https://s3/view/exams/e2.png'])
    // As keys cruas continuam no payload (o form precisa delas pra mesclar exames novos).
    expect(out.avatarKey).toBe('avatars/a.png')
    expect(out.examKeys).toEqual(['exams/e1.jpg', 'exams/e2.png'])
  })

  it('sem avatarKey → avatarUrl null e nenhum presign de avatar', async () => {
    const svc = { getByUserId: jest.fn(async () => profile()) } as any
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
