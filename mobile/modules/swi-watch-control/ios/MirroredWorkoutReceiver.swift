import Foundation
import HealthKit

/// Dicionario de status entregue ao JavaScript. Fica fora da classe gated por
/// disponibilidade para o modulo conseguir responder em iOS anterior ao 17.
enum WatchControlStatusPayload {
  static func make(session: String, changedAt: String?, bpm: Double?, measuredAt: String?) -> [String: Any] {
    var payload: [String: Any] = ["session": session]
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

  static let unavailable = make(session: "none", changedAt: nil, bpm: nil, measuredAt: nil)
}

extension ISO8601DateFormatter {
  static let swi: ISO8601DateFormatter = {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return formatter
  }()
}

/// Payload que o relogio envia pelo canal da sessao espelhada.
struct MirroredPayload: Decodable {
  let type: String
  let bpm: Double?
  let measuredAt: String
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

  var onSessionChanged: ((SessionState, String) -> Void)?
  var onSample: ((Sample) -> Void)?

  var statusPayload: [String: Any] {
    WatchControlStatusPayload.make(
      session: sessionState.rawValue,
      changedAt: sessionChangedAt,
      bpm: lastSample?.bpm,
      measuredAt: lastSample?.measuredAt
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

  private func receive(_ items: [Data]) {
    let decoder = JSONDecoder()
    for item in items {
      guard
        let payload = try? decoder.decode(MirroredPayload.self, from: item),
        payload.type == "heartRate",
        let bpm = payload.bpm,
        bpm.isFinite,
        bpm > 0
      else { continue }
      let sample = Sample(bpm: bpm, measuredAt: payload.measuredAt)
      lastSample = sample
      onSample?(sample)
    }
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
