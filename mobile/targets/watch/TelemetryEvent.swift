import Foundation

/// O evento de telemetria como o backend o aceita, e nada alem disso. A forma
/// vive aqui, sozinha, porque ela e um contrato com outro repositorio: qualquer
/// divergencia passa em toda validacao local e so aparece como recusa no envio,
/// ou pior, como numero errado no painel.
///
/// Referencia: swi-backend/src/telemetry/ingestion/dto/telemetry-batch.dto.ts
/// e src/telemetry/domain/metric-state.ts.

/// Unidades aceitas pelo backend, uma por medicao. Sao texto no JSON, e o
/// backend recusa unidade que nao seja a da metrica.
enum TelemetryUnit: String, Codable {
  case bpm
  case steps
  case kcal
  case count
  case percent = "%"
}

/// Uma medicao. `source` e sempre APPLE_WATCH nesta entrega: o relogio e a
/// unica origem que passa por aqui. Pressao arterial, que tem outras origens,
/// nao vem do relogio e nao aparece neste arquivo.
struct TelemetryMeasurement: Codable {
  let value: Double
  let unit: String
  let source: String

  private init(value: Double, unit: TelemetryUnit) {
    self.value = value
    self.unit = unit.rawValue
    self.source = "APPLE_WATCH"
  }

  static func heartRate(bpm: Double) -> TelemetryMeasurement {
    TelemetryMeasurement(value: bpm, unit: .bpm)
  }

  /// Inteiro de proposito: o backend valida passos com `integer: true` e
  /// recusa negativo. A variacao ja chega arredondada de quem a calculou.
  static func steps(_ delta: Int) -> TelemetryMeasurement {
    TelemetryMeasurement(value: Double(delta), unit: .steps)
  }

  static func energy(kcal: Double) -> TelemetryMeasurement {
    TelemetryMeasurement(value: kcal, unit: .kcal)
  }

  static func motion(peaks: Int) -> TelemetryMeasurement {
    TelemetryMeasurement(value: Double(peaks), unit: .count)
  }

  static func battery(percent: Double) -> TelemetryMeasurement {
    TelemetryMeasurement(value: percent, unit: .percent)
  }
}

/// As cinco medicoes, todas opcionais. Ausente e ausente: chave nula NAO e
/// escrita, porque o backend trata ausencia como ausencia e um zero escrito
/// aqui viraria leitura de verdade la.
struct TelemetryMeasurements: Codable {
  var heartRate: TelemetryMeasurement?
  var stepDelta: TelemetryMeasurement?
  var activeEnergyKcal: TelemetryMeasurement?
  var motionCount: TelemetryMeasurement?
  var battery: TelemetryMeasurement?

  /// Evento sem nenhuma medicao nao tem por que existir; quem monta confere
  /// isto antes de enfileirar.
  var isEmpty: Bool {
    heartRate == nil && stepDelta == nil && activeEnergyKcal == nil
      && motionCount == nil && battery == nil
  }

  enum CodingKeys: String, CodingKey {
    case heartRate, stepDelta, activeEnergyKcal, motionCount, battery
  }

  // Escrito a mao, e nao deixado para a sintese, porque a omissao de chave
  // nula e requisito do contrato e nao um detalhe do compilador.
  func encode(to encoder: Encoder) throws {
    var container = encoder.container(keyedBy: CodingKeys.self)
    try container.encodeIfPresent(heartRate, forKey: .heartRate)
    try container.encodeIfPresent(stepDelta, forKey: .stepDelta)
    try container.encodeIfPresent(activeEnergyKcal, forKey: .activeEnergyKcal)
    try container.encodeIfPresent(motionCount, forKey: .motionCount)
    try container.encodeIfPresent(battery, forKey: .battery)
  }
}

enum TelemetryEventError: Error {
  case notUTF8
}

struct TelemetryEvent: Codable {
  let eventId: String
  let monitoringSessionId: String
  let sequence: Int
  /// ISO-8601 com segundos fracionarios (ISO8601DateFormatter.swi).
  let eventTime: String
  let origin: String
  let measurements: TelemetryMeasurements

  /// Identificadores em MINUSCULAS. O @IsUUID do backend aceita as duas caixas,
  /// mas o Postgres compara texto com diferenca de caixa, e o caminho legado do
  /// iPhone gera minuscula. Uma caixa so em todo o sistema.
  init(
    sessionId: String,
    sequence: Int,
    at date: Date,
    measurements: TelemetryMeasurements,
    eventId: String = UUID().uuidString.lowercased()
  ) {
    self.eventId = eventId
    self.monitoringSessionId = sessionId
    self.sequence = sequence
    self.eventTime = ISO8601DateFormatter.swi.string(from: date)
    self.origin = "REAL"
    self.measurements = measurements
  }
}

extension TelemetryEvent {
  /// Compacto de proposito: sem `.prettyPrinted` o codificador nao escreve
  /// quebra de linha nenhuma.
  static let encoder = JSONEncoder()
  static let decoder = JSONDecoder()

  /// O evento como UMA linha de JSON, que e o que o arquivo da fila guarda e o
  /// que a remessa copia sem alterar.
  ///
  /// A linha nunca contem quebra: o codificador compacto nao produz nenhuma, e
  /// nenhum campo daqui e texto livre. Os unicos textos sao identificadores
  /// (hexadecimal e hifen), unidade, origem e data ISO.
  func line() throws -> String {
    let data = try Self.encoder.encode(self)
    guard let text = String(data: data, encoding: .utf8) else {
      throw TelemetryEventError.notUTF8
    }
    return text
  }

  /// Le de volta uma linha da fila. Usado na retomada, para descobrir a
  /// sequencia e as variacoes que o estado nao chegou a registrar.
  static func from(line: String) -> TelemetryEvent? {
    guard let data = line.data(using: .utf8) else { return nil }
    return try? decoder.decode(TelemetryEvent.self, from: data)
  }
}
