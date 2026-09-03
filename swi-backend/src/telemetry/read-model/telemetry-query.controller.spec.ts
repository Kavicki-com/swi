import { Reflector } from '@nestjs/core'
import { JwtAuthGuard } from '../../auth/jwt-auth.guard'
import { RolesGuard } from '../../auth/roles.guard'
import { TelemetryQueryController } from './telemetry-query.controller'
import type { TelemetryQueryService } from './telemetry-query.service'

// Estas rotas são o único caminho por onde valor de saúde sai do backend. O que
// se testa aqui não é o cálculo, que é do projetor, nem o escopo, que é do
// serviço: é a fiação. Um @Roles esquecido não quebra nenhum outro teste e
// abriria o painel inteiro para qualquer conta autenticada.

const ADMIN = { userId: 'admin-1', role: 'ADMIN', companyId: 'company-1' }
const WORKER = { userId: 'worker-1', role: 'WORKER', companyId: 'company-1' }

const serviceDouble = () =>
  ({
    currentForWorker: jest.fn().mockResolvedValue('estado-proprio'),
    currentForAdmin: jest.fn().mockResolvedValue('estado-do-funcionario'),
    adminSummary: jest.fn().mockResolvedValue('resumo'),
    sessionHistory: jest.fn().mockResolvedValue('historico'),
  }) as any

const controller = (service: any) => new TelemetryQueryController(service as TelemetryQueryService)

const reflector = new Reflector()
const rolesOf = (handler: unknown) => reflector.get<string[]>('roles', handler as never)

describe('TelemetryQueryController: fiação de autorização', () => {
  it('toda a classe exige JWT de pessoa, e não credencial de aparelho', () => {
    // A ingestão usa DeviceAuthGuard porque quem chama é o relógio. Aqui quem
    // chama é gente, e trocar um guard pelo outro deixaria um aparelho pareado
    // ler o painel inteiro.
    const guards: unknown = Reflect.getMetadata('__guards__', TelemetryQueryController)

    expect(guards).toEqual([JwtAuthGuard, RolesGuard])
  })

  it.each(['worker', 'summary'] as const)('%s exige ADMIN', (method) => {
    expect(rolesOf(TelemetryQueryController.prototype[method])).toEqual(['ADMIN'])
  })

  it.each(['me', 'history'] as const)(
    '%s não declara papel: quem confere o dono é o serviço',
    (method) => {
      expect(rolesOf(TelemetryQueryController.prototype[method])).toBeUndefined()
    },
  )
})

describe('TelemetryQueryController: delegação', () => {
  it('nenhuma rota lê o relógio: essa fronteira é do serviço', () => {
    // Mesma escolha da ingestão, que carimba o instante no serviço. O relógio
    // no controller deixaria o serviço sem como ser testado num instante fixo.
    const source = TelemetryQueryController.toString()

    expect(source).not.toContain('new Date(')
  })

  it('me lê o id do token, e nunca da URL', async () => {
    const service = serviceDouble()

    await expect(controller(service).me(WORKER.userId)).resolves.toBe('estado-proprio')
    expect(service.currentForWorker).toHaveBeenCalledWith('worker-1')
  })

  it('worker passa o administrador inteiro, para o serviço aplicar o escopo', async () => {
    const service = serviceDouble()

    await controller(service).worker(ADMIN, 'worker-9')

    expect(service.currentForAdmin).toHaveBeenCalledWith(ADMIN, 'worker-9')
  })

  it('summary não recebe filtro do cliente: o painel é sempre REAL', async () => {
    const service = serviceDouble()
    const instance = controller(service)

    await instance.summary(ADMIN)

    expect(service.adminSummary).toHaveBeenCalledWith(ADMIN)
    // Um parâmetro só, o administrador. Aceitar origem pela query permitiria
    // pedir o painel da demonstração como se fosse o real.
    expect(instance.summary.length).toBe(1)
  })

  it('history repassa o usuário e a paginação como vieram', async () => {
    const service = serviceDouble()

    await controller(service).history(WORKER, 'session-1', { limit: 50, afterSequence: 10 })

    expect(service.sessionHistory).toHaveBeenCalledWith(WORKER, 'session-1', {
      limit: 50,
      afterSequence: 10,
    })
  })
})
