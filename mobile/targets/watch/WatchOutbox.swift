import Foundation

/// Leitor de linhas em blocos. Existe para a fila nunca precisar carregar o
/// arquivo inteiro na memoria: o teto sao 100 mil eventos, uns 25 MB, e um
/// relogio nao tem folga para isso.
private final class LineReader {
  private let handle: FileHandle
  private var buffer = Data()
  private var eof = false
  private let chunkSize = 64 * 1024
  private let newline = UInt8(ascii: "\n")

  /// Bytes consumidos, contando o `\n` de cada linha. Quem varre a fila usa
  /// isto para saber onde a parte nao confirmada comeca.
  private(set) var offset = 0

  init?(url: URL, startingAt start: Int = 0) {
    guard let handle = try? FileHandle(forReadingFrom: url) else { return nil }
    self.handle = handle
    if start > 0 {
      try? handle.seek(toOffset: UInt64(start))
      offset = start
    }
  }

  deinit { try? handle.close() }

  func next() -> String? {
    while true {
      if let index = buffer.firstIndex(of: newline) {
        let line = buffer.subdata(in: buffer.startIndex..<index)
        buffer.removeSubrange(buffer.startIndex...index)
        offset += line.count + 1
        return String(data: line, encoding: .utf8) ?? ""
      }
      if eof {
        // Cauda sem quebra de linha: escrita interrompida no meio. Nao e
        // devolvida, porque nao da para decodifica-la e a proxima escrita a
        // completaria com lixo no meio. Fica para a compactacao descartar.
        return nil
      }
      let chunk = (try? handle.read(upToCount: chunkSize)) ?? nil
      if let chunk, !chunk.isEmpty {
        buffer.append(chunk)
      } else {
        eof = true
      }
    }
  }
}

enum WatchOutboxError: Error {
  case cannotOpenFile
  case cannotEncodeLine
}

/// Estado da fila. Vive num arquivo proprio porque e minusculo e pode ser
/// reescrito a cada evento; o arquivo de eventos so cresce, e reescreve-lo a
/// cada evento seria inviavel no teto.
///
/// Sequencia comeca em 0, entao -1 significa "nenhuma ainda".
struct OutboxState: Codable {
  var version = 1
  var sessionId = ""
  var lastSequence = -1
  var ackedThrough = -1
  var compactedThrough = -1
  var stepBase = 0.0
  var energyBase = 0.0
  var discarded = 0
  /// Ultima remessa numerada. Vive no estado, e nao na memoria, porque o
  /// iPhone guarda a ultima remessa confirmada por sessao: se o relogio
  /// morresse e recomecasse do 1, uma remessa NOVA seria reconhecida como ja
  /// confirmada, e os eventos dela seriam descartados sem nunca ser gravados.
  var lastBatch = 0
  var inFlight: InFlight?

  struct InFlight: Codable {
    let batch: Int
    let from: Int
    let to: Int
    /// Bytes que essas linhas ocupam, para a confirmacao avancar o cursor sem
    /// varrer o arquivo de novo.
    let bytes: Int
  }
}

/// A fila do relogio: guarda cada evento ate o iPhone confirmar que gravou.
///
/// Quatro invariantes sustentam o conjunto, e cada uma tem um jeito conhecido
/// de dar errado se for trocada de ordem:
///
/// 1. Anexar a linha, sincronizar, e SO ENTAO gravar o estado. Ao contrario, o
///    estado apontaria para um evento que nao esta no disco.
/// 2. Na retomada, evento com sequencia maior que a do estado significa morte
///    entre as duas escritas: adota a maior sequencia e SOMA as variacoes
///    desses eventos as bases. E o que permite guardar as bases no estado.
/// 3. Confirmacao nao apaga nada; move uma marca d'agua. Apagar exigiria
///    reescrever ate 25 MB a cada remessa.
/// 4. A compactacao e quem apaga, de vez em quando, e reescreve so o que ainda
///    espera envio.
final class WatchOutbox {
  static let eventsFileName = "swi-watch-outbox.v1.ndjson"
  static let stateFileName = "swi-watch-outbox-state.v1.json"
  /// Uns 25 MB. Segura 48 h mesmo com batimento a cada segundo.
  static let maxPending = 100_000
  /// Quantas confirmacoes acumular antes de reescrever o arquivo.
  static let compactionThreshold = 5_000
  /// Quando o teto estoura, descarta em bloco. Descartar de um em um faria
  /// cada evento novo reescrever o arquivo inteiro.
  static let overflowDropSize = 10_000

  private let eventsURL: URL
  private let stateURL: URL
  private let fileManager = FileManager.default
  private(set) var state = OutboxState()

  /// Byte em que comeca a primeira linha ainda nao confirmada. Vive so na
  /// memoria: e refeito numa varredura unica ao abrir. Sem ele, cada remessa
  /// varreria de novo tudo o que ja foi confirmado, e drenar um acumulo grande
  /// viraria trabalho quadratico.
  private var pendingOffset = 0

  init(directory: URL? = nil) {
    let base = directory
      ?? fileManager.urls(for: .documentDirectory, in: .userDomainMask)[0]
    eventsURL = base.appendingPathComponent(Self.eventsFileName)
    stateURL = base.appendingPathComponent(Self.stateFileName)
  }

  // MARK: - Abertura

  /// O identificador gravado, se houver. O coletor le isto antes de abrir para
  /// decidir se a sessao que o HealthKit devolveu e a mesma de antes.
  var storedSessionId: String? {
    guard let data = try? Data(contentsOf: stateURL),
      let stored = try? JSONDecoder().decode(OutboxState.self, from: data),
      !stored.sessionId.isEmpty
    else { return nil }
    return stored.sessionId
  }

  /// Mesmo identificador que o gravado: retoma. Diferente, ou sem estado:
  /// comeca do zero e apaga o que houver, porque sequencia e bases de outra
  /// sessao nao valem nada nesta.
  func open(sessionId: String) throws {
    if let data = try? Data(contentsOf: stateURL),
      let stored = try? JSONDecoder().decode(OutboxState.self, from: data),
      stored.sessionId == sessionId
    {
      state = stored
      state.inFlight = nil  // reenvia a partir do confirmado
      recoverTail()
    } else {
      try? fileManager.removeItem(at: eventsURL)
      try? fileManager.removeItem(at: stateURL)
      state = OutboxState()
      state.sessionId = sessionId
    }
    if !fileManager.fileExists(atPath: eventsURL.path) {
      fileManager.createFile(atPath: eventsURL.path, contents: nil)
    }
    try compact()
  }

  /// Invariante 2. Varre o arquivo atras de evento que chegou ao disco sem que
  /// o estado registrasse, e devolve as variacoes deles as bases.
  private func recoverTail() {
    guard let reader = LineReader(url: eventsURL) else { return }
    var maxSequence = state.lastSequence
    var steps = 0.0
    var energy = 0.0
    while let line = reader.next() {
      guard !line.isEmpty, let event = TelemetryEvent.from(line: line) else { continue }
      guard event.sequence > state.lastSequence else { continue }
      maxSequence = max(maxSequence, event.sequence)
      steps += event.measurements.stepDelta?.value ?? 0
      energy += event.measurements.activeEnergyKcal?.value ?? 0
    }
    guard maxSequence > state.lastSequence else { return }
    state.lastSequence = maxSequence
    state.stepBase += steps
    state.energyBase += energy
  }

  // MARK: - Escrita

  /// Anexa o evento e devolve a sequencia usada.
  ///
  /// As bases entram na MESMA escrita de estado que a sequencia, de proposito:
  /// quem chama espia a variacao, chama aqui, e so entao confirma os proprios
  /// rastreadores. Se isto lancar, nada avancou e a variacao inteira reaparece
  /// na leitura seguinte.
  @discardableResult
  func append(
    measurements: TelemetryMeasurements,
    at date: Date,
    stepBase: Double,
    energyBase: Double
  ) throws -> Int {
    let sequence = state.lastSequence + 1
    let event = TelemetryEvent(
      sessionId: state.sessionId,
      sequence: sequence,
      at: date,
      measurements: measurements
    )
    guard let data = (try event.line() + "\n").data(using: .utf8) else {
      throw WatchOutboxError.cannotEncodeLine
    }
    try appendToEvents(data)  // invariante 1: disco primeiro
    state.lastSequence = sequence
    state.stepBase = stepBase
    state.energyBase = energyBase
    enforceCap()
    try writeState()
    return sequence
  }

  private func appendToEvents(_ data: Data) throws {
    if !fileManager.fileExists(atPath: eventsURL.path) {
      fileManager.createFile(atPath: eventsURL.path, contents: nil)
    }
    guard let handle = try? FileHandle(forWritingTo: eventsURL) else {
      throw WatchOutboxError.cannotOpenFile
    }
    defer { try? handle.close() }
    try handle.seekToEnd()
    try handle.write(contentsOf: data)
    // Sincronizar aqui e o que faz a confirmacao ao iPhone significar algo.
    try handle.synchronize()
  }

  private func writeState() throws {
    let data = try JSONEncoder().encode(state)
    // `.atomic` escreve num temporario e renomeia: corte de energia no meio
    // nao deixa estado truncado, que seria pior que estado velho.
    try data.write(to: stateURL, options: .atomic)
  }

  // MARK: - Leitura para a remessa

  var pendingCount: Int { state.lastSequence - state.ackedThrough }
  var discarded: Int { state.discarded }
  var acknowledgedThrough: Int { state.ackedThrough }

  /// As proximas linhas a enviar, na ordem, e quanto ocupam em bytes. A leitura
  /// comeca no cursor, entao nao varre o que ja foi confirmado.
  func pending(limit: Int) -> (lines: [String], bytes: Int) {
    guard let reader = LineReader(url: eventsURL, startingAt: pendingOffset) else {
      return ([], 0)
    }
    var lines: [String] = []
    var bytes = 0
    let start = reader.offset
    while lines.count < limit, let line = reader.next() {
      guard !line.isEmpty else { continue }
      lines.append(line)
      bytes = reader.offset - start
    }
    return (lines, bytes)
  }

  /// O proximo numero de remessa. Nunca se repete dentro de uma sessao.
  func nextBatch() -> Int { state.lastBatch + 1 }

  func markInFlight(batch: Int, from: Int, to: Int, bytes: Int) throws {
    state.lastBatch = max(state.lastBatch, batch)
    state.inFlight = OutboxState.InFlight(batch: batch, from: from, to: to, bytes: bytes)
    try writeState()
  }

  /// Invariante 3: move a marca d'agua e o cursor, sem apagar. A compactacao
  /// apaga depois, quando compensar.
  func acknowledge(batch: Int) throws {
    guard let inFlight = state.inFlight, inFlight.batch == batch else { return }
    state.ackedThrough = max(state.ackedThrough, inFlight.to)
    pendingOffset += inFlight.bytes
    state.inFlight = nil
    try writeState()
    if state.ackedThrough - state.compactedThrough >= Self.compactionThreshold {
      try compact()
    }
  }

  // MARK: - Teto e compactacao

  /// Invariante do teto. Descarta em bloco, e o numero vai para a tela: nao ha
  /// evento de perda no backend (pendencia registrada no desenho).
  private func enforceCap() {
    guard pendingCount > Self.maxPending else { return }
    let dropUpTo = min(state.ackedThrough + Self.overflowDropSize, state.lastSequence)
    state.discarded += dropUpTo - state.ackedThrough
    state.ackedThrough = dropUpTo
    state.inFlight = nil
    // O cursor nao serve mais; a compactacao o refaz.
    try? compact()
  }

  /// Invariante 4. Reescreve o arquivo com o que ainda espera envio e zera o
  /// cursor. Tambem descarta uma cauda sem quebra de linha, se houver.
  private func compact() throws {
    guard fileManager.fileExists(atPath: eventsURL.path) else {
      pendingOffset = 0
      return
    }
    let temporaryURL = eventsURL.appendingPathExtension("compacting")
    try? fileManager.removeItem(at: temporaryURL)
    fileManager.createFile(atPath: temporaryURL.path, contents: nil)
    guard let output = try? FileHandle(forWritingTo: temporaryURL) else {
      throw WatchOutboxError.cannotOpenFile
    }
    if let reader = LineReader(url: eventsURL) {
      while let line = reader.next() {
        guard !line.isEmpty, let event = TelemetryEvent.from(line: line) else { continue }
        guard event.sequence > state.ackedThrough else { continue }
        if let data = (line + "\n").data(using: .utf8) {
          try output.write(contentsOf: data)
        }
      }
    }
    try output.synchronize()
    try? output.close()
    _ = try? fileManager.replaceItemAt(eventsURL, withItemAt: temporaryURL)
    pendingOffset = 0
    state.compactedThrough = state.ackedThrough
    try writeState()
  }
}
