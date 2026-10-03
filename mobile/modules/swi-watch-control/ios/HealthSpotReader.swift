import Foundation
import HealthKit

/// Le do app Saude as medicoes avulsas: pressao arterial e temperatura
/// corporal. O relogio nao mede nenhuma das duas. Quem as grava e um aparelho
/// de pressao ou termometro com app proprio, ou o funcionario digitando, e o
/// iPhone so le o que ja esta la.
///
/// Este arquivo nao interpreta nem envia: devolve as amostras cruas, com o
/// horario em que foram medidas, e o JavaScript monta o evento. Tambem nao
/// guarda o que ja leu: o identificador da amostra viaja junto, e a
/// deduplicacao e de quem enfileira.
///
/// Sem `@available`: a consulta em si nao depende da sessao espelhada, que e
/// o que exige iOS 17 no resto do modulo. A autorizacao, porem, e pedida junto
/// com a do relogio, que so existe do iOS 17 em diante: em iOS anterior a
/// consulta roda e devolve vazio, como para quem nunca autorizou.
final class HealthSpotReader {
  static let shared = HealthSpotReader()

  /// Teto por tipo e por leitura. As medicoes sao raras, e a janela pedida e
  /// de poucos dias: vinte cobre com folga, e limita o custo se alguem
  /// importar um historico inteiro para o app Saude.
  private static let limitPerKind = 20

  private let healthStore = HKHealthStore()

  /// Os tipos que esta leitura precisa autorizados. A pressao e uma
  /// correlacao, e o HealthKit nao aceita autorizacao pedida pela correlacao:
  /// lanca excecao. O pedido e pelas duas quantidades que a compoem.
  static var typesToRead: Set<HKObjectType> {
    let identifiers: [HKQuantityTypeIdentifier] = [
      .bloodPressureSystolic,
      .bloodPressureDiastolic,
      .bodyTemperature,
    ]
    var types = Set<HKObjectType>()
    for identifier in identifiers {
      if let type = HKObjectType.quantityType(forIdentifier: identifier) {
        types.insert(type)
      }
    }
    return types
  }

  /// As medicoes registradas desde `since`, da mais nova para a mais antiga
  /// dentro de cada tipo. Sem autorizacao, com o banco de saude trancado ou em
  /// aparelho sem HealthKit, devolve vazio: o iOS nao conta se a leitura foi
  /// negada, e para quem chama "negou" e "nao mediu" sao a mesma coisa.
  ///
  /// As duas consultas correm em serie, uma dentro do retorno da outra, para
  /// nao haver estado compartilhado entre as filas do HealthKit.
  func read(since: Date, completion: @escaping ([[String: Any]]) -> Void) {
    guard HKHealthStore.isHealthDataAvailable() else {
      completion([])
      return
    }
    readBloodPressure(since: since) { pressures in
      self.readBodyTemperature(since: since) { temperatures in
        completion(pressures + temperatures)
      }
    }
  }

  private static func predicate(since: Date) -> NSPredicate {
    HKQuery.predicateForSamples(withStart: since, end: nil, options: [])
  }

  private static var newestFirst: [NSSortDescriptor] {
    [NSSortDescriptor(key: HKSampleSortIdentifierEndDate, ascending: false)]
  }

  /// Um formatador por consulta, no mesmo formato do resto do modulo. O
  /// compartilhado (`ISO8601DateFormatter.swi`) e usado na main, e os retornos
  /// do HealthKit chegam em outra fila: cada consulta com o seu dispensa
  /// depender de o formatador aguentar duas filas ao mesmo tempo.
  private static func makeFormatter() -> ISO8601DateFormatter {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return formatter
  }

  /// Se a amostra foi digitada no app Saude, e nao gravada por um aparelho.
  private static func wasUserEntered(_ sample: HKSample) -> Bool {
    (sample.metadata?[HKMetadataKeyWasUserEntered] as? Bool) ?? false
  }

  private func readBloodPressure(
    since: Date,
    completion: @escaping ([[String: Any]]) -> Void
  ) {
    guard
      let correlationType = HKObjectType.correlationType(forIdentifier: .bloodPressure),
      let systolicType = HKObjectType.quantityType(forIdentifier: .bloodPressureSystolic),
      let diastolicType = HKObjectType.quantityType(forIdentifier: .bloodPressureDiastolic)
    else {
      completion([])
      return
    }

    let query = HKSampleQuery(
      sampleType: correlationType,
      predicate: HealthSpotReader.predicate(since: since),
      limit: HealthSpotReader.limitPerKind,
      sortDescriptors: HealthSpotReader.newestFirst
    ) { _, samples, _ in
      let unit = HKUnit.millimeterOfMercury()
      let formatter = HealthSpotReader.makeFormatter()
      let found: [HKSample] = samples ?? []
      let readings: [[String: Any]] = found.compactMap { (sample: HKSample) -> [String: Any]? in
        // Sem as duas metades nao ha pressao: uma correlacao incompleta e
        // descartada, e nao completada com zero.
        guard
          let correlation = sample as? HKCorrelation,
          let systolic = correlation.objects(for: systolicType).first as? HKQuantitySample,
          let diastolic = correlation.objects(for: diastolicType).first as? HKQuantitySample
        else { return nil }
        let reading: [String: Any] = [
          "kind": "bloodPressure",
          "id": correlation.uuid.uuidString.lowercased(),
          "measuredAt": formatter.string(from: correlation.endDate),
          "systolic": systolic.quantity.doubleValue(for: unit),
          "diastolic": diastolic.quantity.doubleValue(for: unit),
          // O app Saude marca a digitacao nas amostras e na correlacao; a
          // marca em qualquer uma das duas basta.
          "userEntered": HealthSpotReader.wasUserEntered(correlation)
            || HealthSpotReader.wasUserEntered(systolic),
        ]
        return reading
      }
      completion(readings)
    }
    healthStore.execute(query)
  }

  private func readBodyTemperature(
    since: Date,
    completion: @escaping ([[String: Any]]) -> Void
  ) {
    guard let temperatureType = HKObjectType.quantityType(forIdentifier: .bodyTemperature) else {
      completion([])
      return
    }

    let query = HKSampleQuery(
      sampleType: temperatureType,
      predicate: HealthSpotReader.predicate(since: since),
      limit: HealthSpotReader.limitPerKind,
      sortDescriptors: HealthSpotReader.newestFirst
    ) { _, samples, _ in
      let unit = HKUnit.degreeCelsius()
      let formatter = HealthSpotReader.makeFormatter()
      let found: [HKSample] = samples ?? []
      let readings: [[String: Any]] = found.compactMap { (sample: HKSample) -> [String: Any]? in
        guard let quantity = sample as? HKQuantitySample else { return nil }
        let reading: [String: Any] = [
          "kind": "bodyTemperature",
          "id": quantity.uuid.uuidString.lowercased(),
          "measuredAt": formatter.string(from: quantity.endDate),
          "celsius": quantity.quantity.doubleValue(for: unit),
          "userEntered": HealthSpotReader.wasUserEntered(quantity),
        ]
        return reading
      }
      completion(readings)
    }
    healthStore.execute(query)
  }
}
