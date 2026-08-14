// describe/it/expect/afterEach vêm dos globals do Vitest (globals: true no config);
// importar hooks de 'vitest' aqui duplica a instância (deps.inline) e quebra o runner.
import { vi } from 'vitest'
import { ApiError } from './http'
import { workOrdersApi } from './workOrders'

const stub = (body: unknown, status = 200) => {
  const f = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response)
  vi.stubGlobal('fetch', f)
  return f
}

afterEach(() => {
  window.localStorage.clear()
  vi.unstubAllGlobals()
})

describe('workOrdersApi', () => {
  it('list filtra por status na query', async () => {
    const f = stub([])
    await workOrdersApi.list('in_progress')
    expect(f.mock.calls[0]?.[0]).toContain('/work-orders?status=in_progress')
  })

  it('list sem status não manda query', async () => {
    const f = stub([])
    await workOrdersApi.list()
    expect(f.mock.calls[0]?.[0]).toMatch(/\/work-orders$/)
  })

  it('create manda POST com o payload', async () => {
    const f = stub({ id: 'o1' })
    await workOrdersApi.create({ title: 'T', responsibleIds: ['w1'] })
    const init = f.mock.calls[0]?.[1] as RequestInit
    expect(f.mock.calls[0]?.[0]).toMatch(/\/work-orders$/)
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body as string)).toEqual({ title: 'T', responsibleIds: ['w1'] })
  })

  it('update manda PATCH no id', async () => {
    const f = stub({ id: 'o1' })
    await workOrdersApi.update('o1', { title: 'Novo' })
    const init = f.mock.calls[0]?.[1] as RequestInit
    expect(f.mock.calls[0]?.[0]).toMatch(/\/work-orders\/o1$/)
    expect(init.method).toBe('PATCH')
  })

  it('get bate em /work-orders/:id sem method (GET)', async () => {
    const f = stub({ id: 'o1' })
    await workOrdersApi.get('o1')
    expect(f.mock.calls[0]?.[0]).toMatch(/\/work-orders\/o1$/)
    expect((f.mock.calls[0]?.[1] as RequestInit | undefined)?.method).toBeUndefined()
  })

  it('assignable bate em /work-orders/assignable', async () => {
    const f = stub([])
    await workOrdersApi.assignable()
    expect(f.mock.calls[0]?.[0]).toMatch(/\/work-orders\/assignable$/)
  })

  // A reconciliação do PATCH lê `if (item.id)`, ou seja, testa truthy. Um id
  // resolvido pra '' (como em `id: item.id ?? ''`) é falsy e cai no ramo de
  // CRIAÇÃO em silêncio: o item seria recriado e a falha de serialização
  // passaria despercebida até alguém tentar editar um item existente. Pinar a
  // ausência da chave faz o contrato de wire falhar alto aqui, e não em
  // produção.
  it('update serializa item novo sem a chave id', async () => {
    const f = stub({ id: 'o1' })
    await workOrdersApi.update('o1', { items: [{ title: 'Novo passo' }] })
    const body = JSON.parse((f.mock.calls[0]?.[1] as RequestInit).body as string)
    expect(Object.keys(body.items[0])).toEqual(['title'])
  })

  // #5 do backend: responsibleAvatars é index-parallel com responsibleCount —
  // posição sem avatar vira ''. Filtrar aqui desalinharia o "+N" do AvatarGroup.
  it('list preserva avatares vazios (index-parallel com responsibleCount)', async () => {
    stub([{ id: 'o1', responsibleCount: 3, responsibleAvatars: ['a.png', '', 'c.png'] }])
    const rows = await workOrdersApi.list()
    expect(rows[0]?.responsibleAvatars).toEqual(['a.png', '', 'c.png'])
  })

  it('erro do backend propaga como ApiError com status e mensagem', async () => {
    stub({ message: 'responsável inválido' }, 400)
    await expect(workOrdersApi.create({ title: 'T', responsibleIds: ['x'] })).rejects.toMatchObject(
      {
        name: 'ApiError',
        status: 400,
        message: 'responsável inválido',
      },
    )
  })

  // Contrato: o client NÃO defende de responsibleIds vazio — manda e deixa o
  // backend (@ArrayNotEmpty no UpdateWorkOrderDto) responder 400. Um multi-select
  // que permite desmarcar todos produz [] naturalmente, então a validação é da
  // TELA, antes de chamar update.
  it('update com responsibleIds vazio manda e propaga o 400 do backend', async () => {
    const f = stub({ message: 'responsibleIds should not be empty' }, 400)
    await expect(workOrdersApi.update('o1', { responsibleIds: [] })).rejects.toBeInstanceOf(
      ApiError,
    )
    const body = JSON.parse((f.mock.calls[0]?.[1] as RequestInit).body as string)
    expect(body.responsibleIds).toEqual([])
  })
})
