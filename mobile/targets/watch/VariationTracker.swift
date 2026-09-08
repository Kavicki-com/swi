import Foundation

/// Transforma o acumulado que o HealthKit entrega (desde o inicio da sessao)
/// na variacao desde a leitura anterior, que e o que o backend soma.
///
/// A base avanca no mesmo instante em que a variacao e devolvida. Na build 1
/// isso basta, porque a variacao vai direto para a tela. A build 2, que grava
/// o evento numa fila, PRECISA de duas etapas (espiar e so entao confirmar):
/// falha ao enfileirar depois de `observe` perde a variacao para sempre.
///
/// Acumulado MENOR que a base significa sessao nova ou HealthKit zerado. A base
/// e redefinida para o valor recebido e nenhuma variacao sai: variacao negativa
/// nao existe e o backend a recusa. Uma sessao nova deve criar um rastreador
/// novo; esta guarda e a rede para quando isso falhar.
struct VariationTracker {
  private(set) var base: Double

  init(base: Double = 0) {
    self.base = base
  }

  /// A variacao a emitir, ou nil quando nao ha o que emitir: sem mudanca, ou
  /// acumulado retrocedeu.
  mutating func observe(cumulative: Double) -> Double? {
    if cumulative < base {
      base = cumulative
      return nil
    }
    let variation = cumulative - base
    base = cumulative
    return variation > 0 ? variation : nil
  }
}
