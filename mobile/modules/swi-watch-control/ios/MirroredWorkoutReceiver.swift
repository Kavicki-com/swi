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
    watchProtocol: String? = nil,
    inboxPending: Int = 0
  ) -> [String: Any] {
    var payload: [String: Any] = ["session": session]
    // Qual formato o relogio esta falando. Nulo enquanto nada chegou: o app do
    // relogio se instala no ritmo do sistema, entao existe uma janela real de
    // iPhone novo com relogio velho, e a tela precisa poder dizer isso.
    payload["watchProtocol"] = watchProtocol ?? NSNull()
    payload["inboxPending"] = inboxPending
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
    session: "none", changedAt: nil, bpm: nil, measuredAt: nil,
    watchProtocol: nil, inboxPending: 0
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

  private(set) var sessionState: SessionState = .none
  private(set) var sessionChangedAt: String?
  private(set) var lastSample: Sample?
  /// "v1" ou "legacy", conforme o que chegou. Nulo ate a primeira mensagem.
  private(set) var watchProtocol: String?
  /// Ultima remessa confirmada por sessao. So em memoria: se o processo morrer,
  /// o relogio reenvia, as linhas repetem no arquivo, e o JavaScript resolve
  /// pelo identificador do evento. Repetir e barato; perder nao.
  private var acknowledgedBatches: [String: Int] = [:]

  var onSessionChanged: ((SessionState, String) -> Void)?
  var onSample: ((Sample) -> Void)?

  var statusPayload: [String: Any] {
    WatchControlStatusPayload.make(
      session: sessionState.rawValue,
      changedAt: sessionChangedAt,
      bpm: lastSample?.bpm,
      measuredAt: lastSample?.measuredAt,
      watchProtocol: watchProtocol,
      inboxPending: TelemetryInbox.shared.pendingFileCount
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
    sessionState = state
    sessionChangedAt = at
    onSessionChanged?(state, at)
  }

  /// Uma mensagem do relogio. A primeira linha decide o caminho: `batch`
  /// presente e remessa, `type` presente e o formato legado.
  private func receive(_ items: [Data]) {
    for item in items {
      guard let text = String(data: item, encoding: .utf8) else { continue }
      var lines = text.components(separatedBy: "
")
      guard let first = lines.first, !first.isEmpty else { continue }
      guard let headerData = first.data(using: .utf8) else { continue }

      if let header = try? JSONDecoder().decode(EnvelopeHeader.self, from: headerData) {
        lines.removeFirst()
        handle(header: header, eventLines: lines.filter { !$0.isEmpty })
      } else {
        handleLegacy(headerData)
      }
    }
  }

  private func handle(header: EnvelopeHeader, eventLines: [String]) {
    watchProtocol = "v1"

    // Remessa ja confirmada, reenviada porque a confirmacao se perdeu no
    // caminho. Reconfirmar sem gravar de novo evita duplicar a toa; se este
    // processo tiver morrido no meio-tempo a memoria esta vazia, as linhas
    // repetem no arquivo, e o JavaScript deduplica pelo identificador.
    if let acknowledged = acknowledgedBatches[header.session], acknowledged == header.batch {
      acknowledge(batch: header.batch, session: header.session)
      return
    }

    // Confirmar so depois de gravado E sincronizado. Confirmar antes faria o
    // relogio apagar da fila dele algo que ainda podia se perder aqui.
    guard TelemetryInbox.shared.append(lines: eventLines) else { return }
    acknowledgedBatches[header.session] = header.batch
    acknowledge(batch: header.batch, session: header.session)
  }

  private func acknowledge(batch: Int, session: String) {
    guard let workoutSession = self.session else { return }
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
    watchProtocol = "legacy"
    let sample = Sample(bpm: bpm, measuredAt: payload.measuredAt)
    lastSample = sample
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
      self.receive(data)
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
