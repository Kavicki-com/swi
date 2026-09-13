import Foundation

/// Dono do protocolo entre o relogio e o iPhone. Monta a remessa, envia,
/// espera a confirmacao e reenvia quando ela nao vem.
///
/// Nao conhece HealthKit: o envio entra por um closure. Quem tem a sessao
/// espelhada e o coletor, e assim este arquivo fica legivel sozinho.
///
/// A regra que sustenta tudo: o relogio so esquece um evento depois que o
/// iPhone confirma que o gravou de forma duravel. Ter enviado nao basta.
@MainActor
final class MirrorTransport {
  /// Uma remessa cheia sao uns 12 KB. O limite do canal nao e documentado, e
  /// este numero e conservador de proposito.
  static let maxBatchEvents = 50
  /// Enviado e sem confirmacao: reenvia a MESMA remessa, com o mesmo numero.
  static let ackTimeout: TimeInterval = 30
  /// Falha de envio (iPhone fora de alcance) recua, com variacao aleatoria
  /// para dois relogios nao baterem no mesmo instante.
  static let minBackoff: TimeInterval = 5
  static let maxBackoff: TimeInterval = 60
  static let backoffJitter = 0.3

  private struct EnvelopeHeader: Encodable {
    let v = 1
    let batch: Int
    let session: String
    let count: Int
  }

  private struct AckMessage: Decodable {
    let v: Int
    let ack: Int
    let session: String?
  }

  private let outbox: WatchOutbox
  /// Entrega a remessa ao iPhone. O booleano diz se o sistema aceitou enviar,
  /// nao se o iPhone gravou: quem diz isso e a confirmacao.
  private let deliver: @MainActor (Data, @escaping (Bool) -> Void) -> Void

  private var inFlightData: Data?
  private var inFlightBatch: Int?
  private var sending = false
  private var timer: Timer?
  private var backoff: TimeInterval = 0

  init(
    outbox: WatchOutbox,
    deliver: @escaping @MainActor (Data, @escaping (Bool) -> Void) -> Void
  ) {
    self.outbox = outbox
    self.deliver = deliver
  }

  var pendingCount: Int { outbox.pendingCount }
  var discarded: Int { outbox.discarded }
  private(set) var lastAcknowledgedBatch: Int?

  /// Manda a proxima remessa, se houver o que mandar e se nao houver outra em
  /// voo. Chamado a cada evento novo e pelos temporizadores.
  func pump() {
    guard !sending, inFlightBatch == nil else { return }
    let (lines, bytes) = outbox.pending(limit: Self.maxBatchEvents)
    guard !lines.isEmpty else { return }

    // As pontas vem das proprias linhas, e nao de uma conta sobre a marca
    // d'agua: se a fila descartou por estouro, a conta estaria errada.
    guard
      let first = TelemetryEvent.from(line: lines[0]),
      let last = TelemetryEvent.from(line: lines[lines.count - 1])
    else { return }

    let batch = outbox.nextBatch()
    let header = EnvelopeHeader(
      batch: batch,
      session: outbox.state.sessionId,
      count: lines.count
    )
    guard
      let headerData = try? JSONEncoder().encode(header),
      let headerLine = String(data: headerData, encoding: .utf8),
      let payload = ([headerLine] + lines).joined(separator: "\n").data(using: .utf8)
    else { return }

    do {
      try outbox.markInFlight(
        batch: batch,
        from: first.sequence,
        to: last.sequence,
        bytes: bytes
      )
    } catch {
      // Sem registrar a remessa nao da para enviar: uma confirmacao chegaria
      // sem ninguem para atribui-la, e os eventos seriam reenviados de novo.
      return
    }

    inFlightData = payload
    inFlightBatch = batch
    transmit()
  }

  private func transmit() {
    guard let payload = inFlightData else { return }
    sending = true
    // Temporizador armado ANTES de entregar. Se o completion nunca vier (a
    // sessao espelhada morre no meio, o sistema suspende o app antes do
    // callback), `sending` ficaria true para sempre e toda remessa futura
    // morreria na guarda de `pump`. A fila pararia de esvaziar ate o processo
    // reiniciar.
    scheduleTimer(after: Self.ackTimeout)
    deliver(payload) { [weak self] accepted in
      Task { @MainActor in
        guard let self else { return }
        self.sending = false
        if accepted {
          self.backoff = 0
          self.scheduleTimer(after: Self.ackTimeout)
        } else {
          self.scheduleTimer(after: self.nextBackoff())
        }
      }
    }
  }

  private func nextBackoff() -> TimeInterval {
    let base = backoff == 0 ? Self.minBackoff : min(backoff * 2, Self.maxBackoff)
    backoff = base
    let jitter = Double.random(in: -Self.backoffJitter...Self.backoffJitter)
    return max(1, base * (1 + jitter))
  }

  private func scheduleTimer(after interval: TimeInterval) {
    timer?.invalidate()
    timer = Timer.scheduledTimer(withTimeInterval: interval, repeats: false) { [weak self] _ in
      Task { @MainActor in
        self?.retry()
      }
    }
  }

  /// Reenvia a MESMA remessa, com o mesmo numero. Numero novo faria o iPhone
  /// gravar as mesmas linhas duas vezes.
  private func retry() {
    sending = false
    guard inFlightData != nil else {
      pump()
      return
    }
    // O teto da fila pode ter descartado justamente esta remessa. Reenvia-la
    // seria mandar linhas que nao existem mais e esperar por uma confirmacao
    // que ninguem vai poder atribuir.
    guard outbox.hasInFlight else {
      discardInFlight()
      pump()
      return
    }
    transmit()
  }

  private func discardInFlight() {
    timer?.invalidate()
    timer = nil
    inFlightData = nil
    inFlightBatch = nil
    sending = false
    backoff = 0
  }

  /// Uma linha vinda do iPhone. Devolve se era uma confirmacao.
  @discardableResult
  func handle(line: String) -> Bool {
    guard
      let data = line.data(using: .utf8),
      let message = try? JSONDecoder().decode(AckMessage.self, from: data)
    else { return false }
    // A numeracao recomeca a cada sessao, entao uma confirmacao atrasada da
    // sessao anterior poderia casar com a remessa desta e mover a marca d'agua
    // sobre eventos que o iPhone nunca recebeu.
    guard message.session == nil || message.session == outbox.state.sessionId else {
      return true
    }
    guard message.ack == inFlightBatch else {
      // Confirmacao de remessa que nao esta em voo: chegou atrasada, depois de
      // um reenvio. Ignorar e o certo; o reenvio ja resolveu.
      return true
    }
    guard outbox.hasInFlight else {
      // O teto descartou esta remessa antes de a confirmacao chegar. Limpar sem
      // anunciar confirmacao: dizer que foi confirmada mentiria na tela.
      discardInFlight()
      pump()
      return true
    }
    try? outbox.acknowledge(batch: message.ack)
    lastAcknowledgedBatch = message.ack
    inFlightData = nil
    inFlightBatch = nil
    timer?.invalidate()
    timer = nil
    backoff = 0
    // Ainda pode haver acumulo: segue esvaziando.
    pump()
    return true
  }

  func stop() {
    timer?.invalidate()
    timer = nil
    inFlightData = nil
    inFlightBatch = nil
    sending = false
    backoff = 0
  }
}
