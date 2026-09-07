// Erros do domínio de telemetria. São Error puros: quem traduz para HTTP é a
// camada de ingestão. As mensagens não carregam valor de saúde nem token.

export class TelemetryDomainError extends Error {
  constructor(message: string) {
    super(message)
    this.name = new.target.name
  }
}

/** Sessão REAL recebendo evento DEMO, ou o contrário. */
export class TelemetryOriginMismatchError extends TelemetryDomainError {
  constructor(
    readonly sessionOrigin: string,
    readonly eventOrigin: string,
  ) {
    super(`Sessão ${sessionOrigin} não aceita evento ${eventOrigin}`)
  }
}

/** Valor impossível, unidade errada ou origem não permitida para a métrica. */
export class InvalidMeasurementError extends TelemetryDomainError {
  constructor(
    readonly kind: string,
    readonly reason: string,
  ) {
    super(`Medição inválida para ${kind}: ${reason}`)
  }
}

/** Evento bruto fora do contrato, por exemplo tentando impor workerId. */
export class InvalidTelemetryEventError extends TelemetryDomainError {
  constructor(readonly reason: string) {
    super(`Evento de telemetria inválido: ${reason}`)
  }
}
