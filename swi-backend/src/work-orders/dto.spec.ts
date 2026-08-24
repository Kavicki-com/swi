// O @Type(() => WorkOrderItemDto) deste DTO lê metadado de decorator, e quem
// carrega o polyfill em produção é o bootstrap do Nest (main.ts). Fora dele o
// import da classe estoura antes de qualquer teste rodar.
import 'reflect-metadata'
import { validate } from 'class-validator'
import { plainToInstance, type ClassConstructor } from 'class-transformer'
import { CreateWorkOrderDto, UpdateWorkOrderDto } from './dto'

// UUID no formato que o presign emite (36 caracteres com hífens).
const UUID = '00000000-0000-4000-8000-000000000000'
const ORDER = `order/${UUID}.jpg`
const TASK = `task/${UUID}.jpg`

const errosEm = async <T extends object>(Dto: ClassConstructor<T>, body: object, prop: string) => {
  const errs = await validate(plainToInstance(Dto, body))
  return errs.filter((e) => e.property === prop).length
}

// O anexo de uma ordem de serviço tem DUAS origens, e só uma delas passa pelo
// presign do painel: o admin anexa sob `order/` (prefixo ADMIN-only no
// MediaController), e o funcionário fotografa a tarefa pela jornada sob `task/`
// (JourneyPhotoDto), que o addTaskPhoto empurra pro MESMO array do pai
// (WorkOrder.imageKeys). O detalhe devolve as duas cruas, o form de edição as
// devolve no PATCH, e é por isso que o PATCH precisa aceitar as duas: recusar
// `task/` deixava os anexos INEDITÁVEIS em toda ordem que o funcionário
// fotografou, com 400 e mensagem crua do class-validator.
describe('UpdateWorkOrderDto: prefixos que o PATCH tem que aceitar de volta', () => {
  it('aceita a foto que o funcionário tirou na jornada (task/) em imageKeys', async () => {
    expect(await errosEm(UpdateWorkOrderDto, { imageKeys: [TASK] }, 'imageKeys')).toBe(0)
  })

  it('aceita a foto da jornada também no snapshot (imageKeysBase)', async () => {
    // O base é o espelho do que o form carregou; carregando uma foto de jornada,
    // ele a devolve. Recusar aqui trava o mesmo PATCH pelo outro campo.
    expect(await errosEm(UpdateWorkOrderDto, { imageKeysBase: [TASK] }, 'imageKeysBase')).toBe(0)
  })

  it('segue aceitando o anexo do próprio admin (order/) nos dois campos', async () => {
    expect(await errosEm(UpdateWorkOrderDto, { imageKeys: [ORDER] }, 'imageKeys')).toBe(0)
    expect(await errosEm(UpdateWorkOrderDto, { imageKeysBase: [ORDER] }, 'imageKeysBase')).toBe(0)
  })

  it('aceita as duas origens misturadas no mesmo array (é o caso real)', async () => {
    expect(await errosEm(UpdateWorkOrderDto, { imageKeys: [ORDER, TASK] }, 'imageKeys')).toBe(0)
  })

  // A abertura é pros prefixos que o PRÓPRIO servidor grava neste array, e para
  // nenhum outro: seguir recusando o resto é o que impede referenciar objeto de
  // outro domínio do bucket.
  it.each([`reports/${UUID}.jpg`, `chat/${UUID}.jpg`, `avatars/${UUID}.jpg`, `exams/${UUID}.jpg`])(
    'recusa prefixo de outro domínio: %s',
    async (key) => {
      expect(await errosEm(UpdateWorkOrderDto, { imageKeys: [key] }, 'imageKeys')).toBeGreaterThan(0)
    },
  )

  it.each(['task/../../etc/passwd', 'task/nao-e-uuid.jpg', `task/${UUID}.exe`, UUID])(
    'recusa key fora do formato: %s',
    async (key) => {
      expect(await errosEm(UpdateWorkOrderDto, { imageKeys: [key] }, 'imageKeys')).toBeGreaterThan(0)
    },
  )
})

describe('CreateWorkOrderDto: na criação só existe o anexo do admin', () => {
  const base = { title: 'T', responsibleIds: ['u1'] }

  it('aceita order/', async () => {
    expect(await errosEm(CreateWorkOrderDto, { ...base, imageKeys: [ORDER] }, 'imageKeys')).toBe(0)
  })

  // A ordem ainda não existe, logo não existe tarefa nem jornada, logo não
  // existe foto de percurso pra ecoar. Aceitar `task/` aqui só abriria caminho
  // pra referenciar a foto de outra ordem.
  it('recusa task/, que não pode existir antes da ordem', async () => {
    expect(await errosEm(CreateWorkOrderDto, { ...base, imageKeys: [TASK] }, 'imageKeys')).toBeGreaterThan(0)
  })
})
