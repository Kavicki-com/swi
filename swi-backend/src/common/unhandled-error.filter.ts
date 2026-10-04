import { ArgumentsHost, Catch, HttpServer } from '@nestjs/common'
import { AbstractHttpAdapter, BaseExceptionFilter } from '@nestjs/core'
import { describeError, isPrismaError, stackFramesOf } from './describe-error'

// O tratador padrão do Nest registra a mensagem e a pilha de todo erro que
// vira 500. Para erro do Prisma isso põe no log os argumentos da chamada (ver
// describe-error.ts). Este filtro troca só esse registro: a resposta é a mesma
// de antes, as exceções HTTP passam intactas, e erro que não é do Prisma segue
// com mensagem e pilha, porque é o que permite investigar um 500.
@Catch()
export class UnhandledErrorFilter extends BaseExceptionFilter {
  override handleUnknownError(
    exception: unknown,
    host: ArgumentsHost,
    applicationRef: AbstractHttpAdapter | HttpServer,
  ): void {
    if (!isPrismaError(exception)) {
      super.handleUnknownError(exception, host, applicationRef)
      return
    }
    const safe = new Error(describeError(exception))
    safe.stack = stackFramesOf(exception)
    super.handleUnknownError(safe, host, applicationRef)
  }
}
