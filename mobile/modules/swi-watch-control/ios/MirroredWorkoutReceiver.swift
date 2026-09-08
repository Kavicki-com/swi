import Foundation
import HealthKit

/// Dicionario de status entregue ao JavaScript. Fica fora da classe gated por
/// disponibilidade para o modulo conseguir responder em iOS anterior ao 17.
enum WatchControlStatusPayload {
  static func make(
    session: String,
    changedAt: String?,
    bpm: Double?,
    measuredAt: String?,
    watchProtocol: String? = nil
  ) -> [String: Any] {
    var payload: [String: Any] = ["session": session]
    // Qual formato o relogio esta falando. Nulo enquanto nada chegou: o app do
    // relogio se instala no ritmo do sistema, entao existe uma janela real de
    // iPhone novo com relogio velho, e a tela precisa poder dizer isso.
    payload["watchProtocol"] = watchProtocol ?? NSNull()
    if let changedAt {
      payload["sessionChangedAt"] = changedAt
    } else {
      payload["sessionChangedAt"] = NSNull()
    }
    if let bpm, let measuredAt {
      payload["lastSample"] = ["bpm": bpm, "measuredAt": measuredAt] as [String: Any]
    } else {
      payload["lastSample"] = NSNull()
    }
    return payload
  }

  static let unavailable = make(
    session: "none", changedAt: nil, bpm: nil, measuredAt: nil, watchProtocol: nil
  )
}

extension ISO8601DateFormatter {
  static let swi: ISO8601DateFormatter = {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return formatter
  }()
}

/// Formato LEGADO: o relogio antigo manda um objeto so, com o batimento. Sai
/// na entrega seguinte, quando todo relogio do piloto ja tiver atualizado.
struct MirroredPayload: Decodable {
  let type: String
  let bpm: Double?
  let measuredAt: String
}

/// Cabecalho da remessa. E a UNICA coisa que o iPhone interpreta do que o
/// relogio manda: as linhas seguintes sao copiadas para o arquivo sem serem
/// lidas. Menos interpretacao aqui e menos codigo Swift que so uma build do
/// EAS consegue verificar.
struct EnvelopeHeader: Decodable {
  let v: Int
  let batch: Int
  let session: String
  let count: Int
}

/// Recebe a HKWorkoutSession espelhada pelo Apple Watch e os dados enviados
/// pelo relogio. O handler precisa estar registrado no launch do app porque o
/// sistema pode acordar o iPhone em background so para entregar a sessao.
/// Task 1 do piloto: nada aqui persiste nem fala com o backend.
@available(iOS 17.0, *)
final class MirroredWorkoutReceiver: NSObject {
  static let shared = MirroredWorkoutReceiver()

  enum SessionState: String {
    case none, running, ended
  }

  struct Sample {
    let bpm: Double
    let measuredAt: String
  }

  private let healthStore = HKHealthStore()
  private var session: HKWorkoutSession?

  /// Estado lido pelo JavaScript. As escritas vem sempre da main; a leitura
  /// vem da thread do JavaScript, pelo getStatus do modulo. Sao propriedades
  /// comuns, e ler `String?` ou `Sample?` durante a escrita pode pegar um
  /// ponteiro meio trocado e derrubar o app. Dai a trava.
  private let stateLock = NSLock()

  /// `NSLock.withLock` so existe do iOS 16 em diante e o alvo deste modulo e
  /// 15.1, entao a versao propria.
  private func locked<T>(_ body: () -> T) -> T {
    stateLock.lock()
    defer { stateLock.unlock() }
    return body()
  }
  private var _sessionState: SessionState = .none
  private var _sessionChangedAt: String?
  private var _lastSample: Sample?
  /// "v1" ou "legacy", conforme o que chegou. Nulo ate a primeira mensagem.
  private var _watchProtocol: String?

  var sessionState: SessionState { locked { _sessionState } }
  var sessionChangedAt: String? { locked { _sessionChangedAt } }
  var lastSample: Sample? { locked { _lastSample } }
  var watchProtocol: String? { locked { _watchProtocol } }

  /// A ultima remessa confirmada, com uma impressao do conteudo. So existe uma
  /// sessao espelhada por vez, entao um registro basta.
  ///
  /// A impressao e o que impede o pior caso: o relogio pode reiniciar no meio
  /// da sessao e repetir um numero de remessa com conteudo DIFERENTE. Comparar
  /// so o numero confirmaria essa remessa sem grava-la, e o relogio a apagaria
  /// da fila dele. So em memoria: se o processo morrer, o relogio reenvia, as
  /// linhas repetem no arquivo, e o JavaScript resolve pelo identificador do
  /// evento. Repetir e barato; perder nao.
  private var lastAcknowledged: (session: String, batch: Int, fingerprint: Int)?

  var onSessionChanged: ((SessionState, String) -> Void)?
  var onSample: ((Sample) -> Void)?

  var statusPayload: [String: Any] {
    // Uma leitura so, coerente entre si: quatro leituras separadas poderiam
    // pegar metade de um estado e metade do seguinte.
    let (state, changedAt, sample, watchProtocol) = locked {
      (_sessionState, _sessionChangedAt, _lastSample, _watchProtocol)
    }
    return WatchControlStatusPayload.make(
      session: state.rawValue,
      changedAt: changedAt,
      bpm: sample?.bpm,
      measuredAt: sample?.measuredAt,
      watchProtocol: watchProtocol
    )
  }

  func install() {
    guard HKHealthStore.isHealthDataAvailable() else { return }
    healthStore.workoutSessionMirroringStartHandler = { [weak self] mirroredSession in
      DispatchQueue.main.async {
        self?.attach(mirroredSession)
      }
    }
  }

  /// Autorizacao do HealthKit no iPhone. A amostra oficial de mirroring da
  /// Apple pede autorizacao nos dois aparelhos; sem ela a sessao espelhada
  /// pode nunca ser entregue. O sistema so mostra o dialogo uma vez.
  func requestAuthorization(completion: @escaping (Bool) -> Void) {
    guard HKHealthStore.isHealthDataAvailable() else {
      completion(false)
      return
    }
    // Os mesmos tres tipos que o relogio le. A folha do sistema no primeiro uso
    // e esta; pedir menos do que a tela promete seria uma contradicao lida pelo
    // funcionario, e o sistema so pergunta uma vez por tipo.
    let typesToRead: Set<HKObjectType> = [
      HKQuantityType(.heartRate),
      HKQuantityType(.activeEnergyBurned),
      HKQuantityType(.stepCount),
    ]
    let typesToShare: Set<HKSampleType> = [HKWorkoutType.workoutType()]
    healthStore.requestAuthorization(toShare: typesToShare, read: typesToRead) { granted, _ in
      DispatchQueue.main.async {
        completion(granted)
      }
    }
  }

  /// Ativa o monitoramento no relogio. Acao distinta de autorizar (ADR-0003):
  /// acorda o app do relogio e entrega a configuracao, que o delegate de la
  /// recebe em handle(_:) e usa para abrir a sessao espelhada.
  ///
  /// Recusa do sistema resolve false; a tela le o estado derivado depois e
  /// mostra indisponivel se nenhuma leitura chegar.
  ///
  /// A API tem duas formas e elas nao se misturam. `startWatchApp(with:completion:)`
  /// e a antiga, de iOS 10; `startWatchApp(toHandle:)` e `async throws` e e a
  /// que a amostra oficial de espelhamento usa. Escrever `toHandle:` com
  /// callback nao compila.
  ///
  /// A HKWorkoutConfiguration nasce dentro do Task porque nao e Sendable e nao
  /// pode ser capturada de fora ao cruzar a fronteira de concorrencia.
  func startMonitoring(completion: @escaping (Bool) -> Void) {
    guard HKHealthStore.isHealthDataAvailable() else {
      completion(false)
      return
    }
    Task { [healthStore] in
      let configuration = HKWorkoutConfiguration()
      configuration.activityType = .other
      configuration.locationType = .indoor
      let started: Bool
      do {
        try await healthStore.startWatchApp(toHandle: configuration)
        started = true
      } catch {
        started = false
      }
      await MainActor.run {
        completion(started)
      }
    }
  }

  private func attach(_ mirroredSession: HKWorkoutSession) {
    session = mirroredSession
    mirroredSession.delegate = self
    update(state: .running)
  }

  private func update(state: SessionState) {
    let at = ISO8601DateFormatter.swi.string(from: Date())
    locked {
      _sessionState = state
      _sessionChangedAt = at
    }
    // Fora da trava: o ouvinte pode ler o status, e ler de dentro travaria.
    onSessionChanged?(state, at)
  }

  /// Uma mensagem do relogio. A primeira linha decide o caminho: `batch`
  /// presente e remessa, `type` presente e o formato legado.
  private func receive(_ items: [Data], from workoutSession: HKWorkoutSession) {
    for item in items {
      guard let text = String(data: item, encoding: .utf8) else { continue }
      // Filtrar ANTES de escolher a primeira: uma mensagem que comece com
      // quebra de linha teria primeira linha vazia e seria descartada inteira,
      // sem confirmacao, e o relogio a reenviaria para sempre.
      var lines = text.components(separatedBy: "\n").filter { !$0.isEmpty }
      guard let first = lines.first else { continue }
      guard let headerData = first.data(using: .utf8) else { continue }

      if let header = try? JSONDecoder().decode(EnvelopeHeader.self, from: headerData) {
        lines.removeFirst()
        handle(header: header, eventLines: lines, on: workoutSession)
      } else {
        handleLegacy(headerData)
      }
    }
  }

  private func handle(
    header: EnvelopeHeader,
    eventLines: [String],
    on workoutSession: HKWorkoutSession
  ) {
    // Versao diferente tem semantica diferente. Tratar v2 como v1 gravaria
    // evento com sentido trocado, que e pior que nao gravar.
    guard header.v == 1 else { return }

    locked { _watchProtocol = "v1" }

    let fingerprint = eventLines.joined(separator: "\n").hashValue

    // Remessa ja confirmada, reenviada porque a confirmacao se perdeu no
    // caminho. Reconfirmar sem gravar de novo evita duplicar a toa. A
    // impressao do conteudo entra na comparacao porque o relogio pode
    // reiniciar e repetir um numero com conteudo diferente.
    if let acknowledged = lastAcknowledged,
      acknowledged.session == header.session,
      acknowledged.batch == header.batch,
      acknowledged.fingerprint == fingerprint
    {
      acknowledge(batch: header.batch, session: header.session, on: workoutSession)
      return
    }

    // Remessa truncada: confirmar faria o relogio apagar da fila dele os
    // eventos que nunca chegaram aqui. Sem confirmacao ele reenvia inteira.
    guard eventLines.count == header.count else { return }

    // Confirmar so depois de gravado E sincronizado. Confirmar antes faria o
    // relogio apagar da fila dele algo que ainda podia se perder aqui.
    guard TelemetryInbox.shared.append(lines: eventLines) else { return }
    lastAcknowledged = (header.session, header.batch, fingerprint)
    acknowledge(batch: header.batch, session: header.session, on: workoutSession)
  }

  /// A sessao vem do delegate, e nao do campo `session`, que e zerado quando a
  /// sessao encerra. Uma remessa entregue logo depois desse encerramento seria
  /// gravada e memoizada, mas a confirmacao nao sairia, e o relogio reenviaria
  /// para sempre sem nunca ser atendido.
  private func acknowledge(batch: Int, session: String, on workoutSession: HKWorkoutSession) {
    // Serializado, e nao montado com texto: o identificador vem de fora deste
    // arquivo, e uma aspa nele produziria um JSON quebrado que o relogio
    // descartaria em silencio, deixando a remessa sem confirmacao para sempre.
    let ack: [String: Any] = ["v": 1, "ack": batch, "session": session]
    guard let data = try? JSONSerialization.data(withJSONObject: ack) else { return }
    workoutSession.sendToRemoteWorkoutSession(data: data) { _, _ in
      // Confirmacao perdida nao e problema: o relogio reenvia a mesma remessa,
      // e o ramo de cima reconhece e reconfirma.
    }
  }

  private func handleLegacy(_ data: Data) {
    guard
      let payload = try? JSONDecoder().decode(MirroredPayload.self, from: data),
      payload.type == "heartRate",
      let bpm = payload.bpm,
      bpm.isFinite,
      bpm > 0
    else { return }
    let sample = Sample(bpm: bpm, measuredAt: payload.measuredAt)
    locked {
      _watchProtocol = "legacy"
      _lastSample = sample
    }
    onSample?(sample)
  }
}

@available(iOS 17.0, *)
extension MirroredWorkoutReceiver: HKWorkoutSessionDelegate {
  func workoutSession(
    _ workoutSession: HKWorkoutSession,
    didChangeTo toState: HKWorkoutSessionState,
    from fromState: HKWorkoutSessionState,
    date: Date
  ) {
    DispatchQueue.main.async {
      switch toState {
      case .running:
        self.update(state: .running)
      case .ended:
        self.update(state: .ended)
        self.session = nil
      default:
        break
      }
    }
  }

  func workoutSession(_ workoutSession: HKWorkoutSession, didFailWithError error: Error) {
    DispatchQueue.main.async {
      self.update(state: .ended)
      self.session = nil
    }
  }

  func workoutSession(
    _ workoutSession: HKWorkoutSession,
    didReceiveDataFromRemoteWorkoutSession data: [Data]
  ) {
    DispatchQueue.main.async {
      self.receive(data, from: workoutSession)
    }
  }

  func workoutSession(
    _ workoutSession: HKWorkoutSession,
    didDisconnectFromRemoteDeviceWithError error: Error?
  ) {
    // A sessao continua valida no relogio; o estado local so muda quando o
    // HealthKit informar encerramento. Sem log de payload.
  }
}
