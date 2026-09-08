import Foundation

/// Transforma o acumulado que o HealthKit entrega (desde o inicio da sessao)
/// na variacao desde a leitura anterior, que e o que o backend soma.
///
/// Duas etapas de proposito. `peek` diz qual variacao sairia sem mexer em
/// nada; `commit` avanca a base. Quem chama enfileira o evento entre as duas,
/// entao falha ao enfileirar nao perde a variacao: ela reaparece inteira na
/// leitura seguinte, porque a base nao andou. Uma chamada so, que devolvesse e
/// avancasse junto, perderia a variacao nesse caso.
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

  /// A variacao que sairia, sem mexer na base. nil quando nao ha o que emitir:
  /// sem mudanca, ou acumulado retrocedeu.
  func peek(cumulative: Double) -> Double? {
    if cumulative < base { return nil }
    let variation = cumulative - base
    return variation > 0 ? variation : nil
  }

  /// Avanca a base, e so depois de o evento estar gravado na fila. Chamado
  /// tambem quando `peek` devolveu nil: no retrocesso e justamente isto que
  /// redefine a base para o valor recebido.
  mutating func commit(cumulative: Double) {
    base = cumulative
  }
}
