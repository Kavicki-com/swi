import { IsObject, IsOptional, IsUUID } from 'class-validator'

// Corpos e parâmetros das rotas de calibração. O conteúdo de `cuts` e `values`
// muda por medição e por trava, então aqui só se exige um objeto: o formato e
// a plausibilidade são conferidos no serviço (validateCuts, validateSafety).

export class CalibrationHistoryQueryDto {
  /** Id do último item da página anterior. */
  @IsOptional() @IsUUID() cursor?: string
}

export class BandOverrideDto {
  /** Cortes da medição, número ou nulo por chave (ex.: excellence e fatigue). */
  @IsObject() cuts!: Record<string, number | null>
}

export class SafetyLimitDto {
  /** Valores da trava (openAt e closeAt; na pressão, os quatro limites). */
  @IsObject() values!: Record<string, number>
}
