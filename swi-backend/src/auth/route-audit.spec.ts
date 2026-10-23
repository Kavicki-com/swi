import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { RequestMethod } from '@nestjs/common'
import { CONTROLLER_WATERMARK, METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants'
import type { AuditAction } from '@prisma/client'
import { AUDIT_ACTIONS } from '../audit/audit-actions'
import { AUDIT_KEY, type AuditMetadata } from '../audit/audit.decorator'
import type { Permission } from './permissions'
import { PERMISSION_KEY } from './roles.decorator'

// Toda rota que opera sobre os dados de UMA pessoa com permissão de
// monitoramento, de cadastro, de aparelho, de alerta ou de resgate deixa linha
// na trilha de auditoria. Os controllers são achados no disco, não numa lista:
// controller novo entra sozinho, e rota nova com uma dessas permissões e sem
// @Audit reprova aqui até alguém decidir se ela é lista (e explicar abaixo) ou
// se precisa de trilha.

const AUDITED_PERMISSIONS: Permission[] = [
  'monitoring.read',
  'monitoring.bands.manage',
  'monitoring.safety.manage',
  'monitoring.pause',
  'alerts.operate',
  'users.read',
  'users.manage',
  'devices.manage',
  'rescue.operate',
]

// Listas leem muita gente de uma vez e ficam fora da trilha por decisão: a
// trilha é do acesso aos dados de uma pessoa, e a lista é o que o painel abre
// o tempo todo.
const LISTS = [
  'TelemetryQueryController.summary',
  'TelemetryQueryController.workers',
  'UsersController.list',
  'UsersController.listPending',
  'AlertQueueController.list',
  // Quem está transmitindo agora: nomes, sem dado de saúde nem uma pessoa escolhida.
  'LiveController.list',
]

// Sem permissão declarada, mas lê dado de saúde de outra pessoa quando quem
// pede é do painel: o serviço é que decide, e o dono lendo a própria sessão
// não grava linha.
const AUDITED_WITHOUT_PERMISSION = ['TelemetryQueryController.history']

interface Route {
  name: string
  verb: RequestMethod
  path: string
  permission: Permission | undefined
  audit: AuditMetadata | undefined
}

function controllerFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return controllerFiles(path)
    return entry.name.endsWith('.controller.ts') ? [path] : []
  })
}

const segments = (path: unknown): string[] =>
  typeof path === 'string' ? path.split('/').filter((s) => s.length > 0) : []

function collectRoutes(): Route[] {
  const routes: Route[] = []
  for (const file of controllerFiles(join(__dirname, '..'))) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const exported = require(file) as Record<string, unknown>
    for (const value of Object.values(exported)) {
      if (typeof value !== 'function' || !Reflect.getMetadata(CONTROLLER_WATERMARK, value)) continue
      const cls = value as { name: string; prototype: Record<string, unknown> }
      for (const handler of Object.getOwnPropertyNames(cls.prototype)) {
        const fn = cls.prototype[handler]
        if (typeof fn !== 'function') continue
        const verb = Reflect.getMetadata(METHOD_METADATA, fn) as RequestMethod | undefined
        if (verb === undefined) continue
        routes.push({
          name: `${cls.name}.${handler}`,
          verb,
          path: `/${[...segments(Reflect.getMetadata(PATH_METADATA, cls)), ...segments(Reflect.getMetadata(PATH_METADATA, fn))].join('/')}`,
          permission: (Reflect.getMetadata(PERMISSION_KEY, fn) ?? Reflect.getMetadata(PERMISSION_KEY, cls)) as Permission | undefined,
          audit: Reflect.getMetadata(AUDIT_KEY, fn) as AuditMetadata | undefined,
        })
      }
    }
  }
  return routes
}

const ROUTES = collectRoutes()
const byName = (name: string): Route | undefined => ROUTES.find((r) => r.name === name)

const mustAudit = ROUTES.filter(
  (r) => (r.permission !== undefined && AUDITED_PERMISSIONS.includes(r.permission) && !LISTS.includes(r.name)) ||
    AUDITED_WITHOUT_PERMISSION.includes(r.name),
)
const audited = ROUTES.filter((r) => r.audit !== undefined)

/** Parâmetros que a metadata da trilha lê do caminho. */
function pathParamsOf(meta: AuditMetadata): string[] {
  const params: string[] = []
  if ('param' in meta.subject) params.push(meta.subject.param)
  if (meta.resource && 'param' in meta.resource) params.push(meta.resource.param)
  return params
}

describe('trilha de auditoria nas rotas', () => {
  it('acha os controllers no disco (a varredura não pode passar vazia)', () => {
    expect(byName('UsersController.getOne')).toBeDefined()
    expect(byName('TelemetryQueryController.worker')).toBeDefined()
    expect(mustAudit.length).toBeGreaterThan(20)
  })

  it.each(mustAudit.map((r) => [r.name, r.path] as const))('%s (%s) tem @Audit', (name) => {
    expect(byName(name)?.audit).toBeDefined()
  })

  it.each(LISTS)('a lista %s existe e não tem @Audit', (name) => {
    const route = byName(name)
    expect(route).toBeDefined()
    expect(route?.audit).toBeUndefined()
  })

  it('ler a própria trilha não gera linha nela', () => {
    expect(byName('AuditController.list')?.permission).toBe('audit.read')
    expect(byName('AuditController.list')?.audit).toBeUndefined()
  })

  it('rotas do próprio funcionário (me/*) não são auditadas', () => {
    const own = ROUTES.filter((r) => r.path.split('/').includes('me'))
    expect(own.length).toBeGreaterThan(0)
    for (const route of own) expect([route.name, route.audit]).toEqual([route.name, undefined])
  })

  it.each(audited.map((r) => [r.name, r.audit!.action] as const))(
    '%s usa %s com o tipo certo para o verbo',
    (name, action) => {
      const route = byName(name)!
      const expected = route.verb === RequestMethod.GET ? 'read' : 'write'
      expect(AUDIT_ACTIONS[action].kind).toBe(expected)
    },
  )

  it.each(audited.map((r) => [r.name, r.path] as const))('%s lê só parâmetros que existem em %s', (name, path) => {
    for (const param of pathParamsOf(byName(name)!.audit!)) {
      expect(path.split('/')).toContain(`:${param}`)
    }
  })

  it('toda ação do enum é usada por alguma rota', () => {
    const used = new Set(audited.map((r) => r.audit!.action))
    const unused = (Object.keys(AUDIT_ACTIONS) as AuditAction[]).filter((a) => !used.has(a))
    expect(unused).toEqual([])
  })
})
