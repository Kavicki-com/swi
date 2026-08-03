import { plainToInstance } from 'class-transformer'
import { validate } from 'class-validator'
import { CreateExamDto, UpdateProfileDto } from './dto'

// QA F (2026-07-24): o settings do admin coletava setor/cargo/saúde e o
// ValidationPipe (whitelist) DESCARTAVA tudo que não estava no DTO — o "salvar"
// virava no-op silencioso pros campos novos. Estes testes travam a superfície.
describe('UpdateProfileDto', () => {
  const valid = async (body: Record<string, unknown>) => {
    const dto = plainToInstance(UpdateProfileDto, body)
    const errors = await validate(dto, { whitelist: true })
    return { dto, errors }
  }

  it('aceita os campos de exibição e saúde do settings', async () => {
    const { dto, errors } = await valid({
      fullName: 'Ana',
      sector: 'Setor Leste',
      jobTitle: 'Operadora',
      gender: 'Feminino',
      bloodType: 'O+',
      allergies: 'Poeira',
      chronicConditions: 'Nenhuma',
      managerName: 'Carlos Supervisor',
    })
    expect(errors).toHaveLength(0)
    expect(dto.sector).toBe('Setor Leste')
    expect(dto.jobTitle).toBe('Operadora')
    expect(dto.bloodType).toBe('O+')
    expect(dto.managerName).toBe('Carlos Supervisor')
  })

  it('aceita duty (Função do settings) e avatarKey no namespace avatars/', async () => {
    const { dto, errors } = await valid({
      duty: 'Operação',
      avatarKey: 'avatars/2b0f7c1a-1111-2222-3333-444455556666.png',
    })
    expect(errors).toHaveLength(0)
    expect(dto.duty).toBe('Operação')
    expect(dto.avatarKey).toBe('avatars/2b0f7c1a-1111-2222-3333-444455556666.png')
  })

  it('rejeita avatarKey fora do namespace avatars/ (outro prefixo ou URL)', async () => {
    const bad = await valid({ avatarKey: 'exams/2b0f7c1a-1111-2222-3333-444455556666.png' })
    expect(bad.errors.length).toBeGreaterThan(0)
    const url = await valid({ avatarKey: 'https://bucket/avatars/x.png' })
    expect(url.errors.length).toBeGreaterThan(0)
  })

  it('aceita examKeys no formato exams/<uuid>.(jpg|png)', async () => {
    const { errors } = await valid({
      examKeys: ['exams/2b0f7c1a-1111-2222-3333-444455556666.jpg'],
    })
    expect(errors).toHaveLength(0)
  })

  it('rejeita examKeys fora do namespace exams/ (ex.: URL assinada ou outro prefixo)', async () => {
    const bad = await valid({ examKeys: ['order/2b0f7c1a-1111-2222-3333-444455556666.jpg'] })
    expect(bad.errors.length).toBeGreaterThan(0)
    const url = await valid({ examKeys: ['https://bucket/exams/x.jpg'] })
    expect(url.errors.length).toBeGreaterThan(0)
  })
})

// Exame clínico costuma chegar como PDF (laudo do laboratório), não como foto.
// O presign já emite key .pdf/.txt pro prefixo exams/, mas o cadastro ainda
// recusava a key emitida: o arquivo subia pro bucket e o POST /profile/exams
// devolvia 400. Estes testes travam as duas pontas na MESMA lista de extensões.
describe('CreateExamDto', () => {
  const UUID = '2b0f7c1a-1111-2222-3333-444455556666'
  const valid = async (body: Record<string, unknown>) => {
    const dto = plainToInstance(CreateExamDto, body)
    const errors = await validate(dto, { whitelist: true })
    return { dto, errors }
  }
  // name/date sempre válidos: o que está sob teste é só o fileKey.
  const withKey = (fileKey: string) => valid({ name: 'Hemograma', date: '2027-03-10', fileKey })

  it.each(['jpg', 'png', 'pdf', 'txt'])('aceita fileKey exams/<uuid>.%s', async (ext) => {
    const { errors } = await withKey(`exams/${UUID}.${ext}`)
    expect(errors).toHaveLength(0)
  })

  it('rejeita fileKey de outro namespace (avatars/) mesmo com extensão permitida', async () => {
    const { errors } = await withKey(`avatars/${UUID}.pdf`)
    expect(errors.length).toBeGreaterThan(0)
  })

  it('rejeita extensão fora da lista (executável não é exame)', async () => {
    const { errors } = await withKey(`exams/${UUID}.exe`)
    expect(errors.length).toBeGreaterThan(0)
  })

  it('rejeita id malformado (só key emitida pelo presign passa)', async () => {
    const { errors } = await withKey('exams/nao-e-uuid.pdf')
    expect(errors.length).toBeGreaterThan(0)
  })
})
