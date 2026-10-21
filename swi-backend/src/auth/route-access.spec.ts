import { ExecutionContext } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { RolesGuard } from './roles.guard'
import { CamerasController } from '../cameras/cameras.controller'
import { EvacuationsController } from '../evacuation/evacuations.controller'
import { LiveController } from '../live/live.controller'
import { NotificationController } from '../notifications/notification.controller'
import { PositionsController } from '../positions/positions.controller'
import { RescueController } from '../rescue/rescue.controller'
import { AlertQueueController } from '../telemetry/alerts/alert-queue.controller'
import { CalibrationController } from '../telemetry/calibration/calibration.controller'
import { TelemetryDevicesController } from '../telemetry/devices/telemetry-devices.controller'
import { TelemetryQueryController } from '../telemetry/read-model/telemetry-query.controller'
import { UsersController } from '../users/users.controller'
import { WeatherController } from '../weather/weather.controller'
import { WorkOrdersController } from '../work-orders/work-orders.controller'

// Quem passa pelo RolesGuard em cada rota com papel declarado. A tabela é a
// matriz de permissões aplicada: um @Roles esquecido ou trocado num controller
// aparece aqui como linha vermelha, mesmo com permissions.ts certo.
// Relatórios e mídia ficam de fora: são de outra frente.
const ROLES = ['WORKER', 'SUPERVISOR', 'ADMIN'] as const
type R = (typeof ROLES)[number]
const PAINEL: R[] = ['SUPERVISOR', 'ADMIN']
const ADMIN: R[] = ['ADMIN']
const WORKER: R[] = ['WORKER']
const TODOS: R[] = [...ROLES]

type Row = [string, any, string, R[]]
const TABLE: Row[] = [
  // Usuários e administradores: Supervisor só lê.
  ['users', UsersController, 'list', PAINEL],
  ['users', UsersController, 'listPending', PAINEL],
  ['users', UsersController, 'getOne', PAINEL],
  ['users', UsersController, 'create', ADMIN],
  ['users', UsersController, 'approve', ADMIN],
  ['users', UsersController, 'reject', ADMIN],
  ['users', UsersController, 'update', ADMIN],
  ['users', UsersController, 'addExam', ADMIN],
  ['users', UsersController, 'removeExam', ADMIN],
  ['users', UsersController, 'remove', ADMIN],
  // Monitoramento.
  ['telemetry-query', TelemetryQueryController, 'worker', PAINEL],
  ['telemetry-query', TelemetryQueryController, 'workerSeries', PAINEL],
  ['telemetry-query', TelemetryQueryController, 'summary', PAINEL],
  ['telemetry-query', TelemetryQueryController, 'workers', PAINEL],
  ['telemetry-query', TelemetryQueryController, 'me', TODOS],
  ['telemetry-devices', TelemetryDevicesController, 'deviceOfWorker', PAINEL],
  ['telemetry-devices', TelemetryDevicesController, 'createEnrollment', ADMIN],
  ['telemetry-devices', TelemetryDevicesController, 'revoke', ADMIN],
  ['telemetry-devices', TelemetryDevicesController, 'complete', TODOS],
  ['alert-queue', AlertQueueController, 'list', PAINEL],
  ['alert-queue', AlertQueueController, 'acknowledge', PAINEL],
  ['alert-queue', AlertQueueController, 'resolve', PAINEL],
  // Calibração: faixa pelo painel, trava só pelo admin.
  ['calibration', CalibrationController, 'detail', PAINEL],
  ['calibration', CalibrationController, 'history', PAINEL],
  ['calibration', CalibrationController, 'setBand', PAINEL],
  ['calibration', CalibrationController, 'clearBand', PAINEL],
  ['calibration', CalibrationController, 'setSafety', ADMIN],
  ['calibration', CalibrationController, 'clearSafety', ADMIN],
  ['notifications', NotificationController, 'pauseRequest', PAINEL],
  ['positions', PositionsController, 'list', PAINEL],
  ['positions', PositionsController, 'heat', TODOS],
  ['positions', PositionsController, 'heartbeat', WORKER],
  ['positions', PositionsController, 'batch', WORKER],
  // Ordens de serviço.
  ['work-orders', WorkOrdersController, 'create', PAINEL],
  ['work-orders', WorkOrdersController, 'list', PAINEL],
  ['work-orders', WorkOrdersController, 'listAssignable', PAINEL],
  ['work-orders', WorkOrdersController, 'get', PAINEL],
  ['work-orders', WorkOrdersController, 'update', PAINEL],
  ['work-orders', WorkOrdersController, 'remove', PAINEL],
  // Câmeras e transmissão: Supervisor vê, não cadastra.
  ['cameras', CamerasController, 'create', ADMIN],
  ['cameras', CamerasController, 'update', ADMIN],
  ['cameras', CamerasController, 'remove', ADMIN],
  ['live', LiveController, 'list', PAINEL],
  // Evacuação e resgate: Supervisor opera.
  ['evacuations', EvacuationsController, 'start', PAINEL],
  ['evacuations', EvacuationsController, 'end', PAINEL],
  ['evacuations', EvacuationsController, 'active', TODOS],
  ['evacuations', EvacuationsController, 'ack', WORKER],
  ['rescue', RescueController, 'arrive', PAINEL],
  ['rescue', RescueController, 'end', PAINEL],
  ['rescue', RescueController, 'dispatch', PAINEL],
  // Clima: Supervisor lê o local da obra, não altera.
  ['weather', WeatherController, 'location', PAINEL],
  ['weather', WeatherController, 'setLocation', ADMIN],
  ['weather', WeatherController, 'resetLocation', ADMIN],
]

const ctx = (cls: any, handler: string, role: R): ExecutionContext =>
  ({
    getHandler: () => cls.prototype[handler],
    getClass: () => cls,
    switchToHttp: () => ({ getRequest: () => ({ user: { role } }) }),
  }) as any

describe('acesso por papel nas rotas', () => {
  const guard = new RolesGuard(new Reflector())

  it.each(TABLE)('%s.%s', (_name, cls, handler, allowed) => {
    expect(typeof cls.prototype[handler]).toBe('function')
    const passed = ROLES.filter((role) => guard.canActivate(ctx(cls, handler, role)))
    expect(passed).toEqual(ROLES.filter((role) => allowed.includes(role)))
  })
})
