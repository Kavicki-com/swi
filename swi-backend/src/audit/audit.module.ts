import { Module } from '@nestjs/common'
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core'
import { AuditController } from './audit.controller'
import { AuditGuard } from './audit.guard'
import { AuditInterceptor } from './audit.interceptor'
import { AuditService } from './audit.service'

// Trilha de auditoria. O guard e o interceptor são globais: a rota só declara
// @Audit, e nenhum controller precisa importar este módulo.
@Module({
  controllers: [AuditController],
  providers: [
    AuditService,
    { provide: APP_GUARD, useClass: AuditGuard },
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
  ],
  exports: [AuditService],
})
export class AuditModule {}
