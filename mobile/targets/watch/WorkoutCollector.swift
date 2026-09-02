import Combine
import Foundation
import HealthKit

/// Coletor descartavel do gate tecnico (Task 1). Mantem uma HKWorkoutSession
/// espelhada para o iPhone e encaminha cada amostra de BPM assim que o
/// HealthKit a entrega. Nada aqui fala com o backend nem persiste dados.
@MainActor
final class WorkoutCollector: NSObject, ObservableObject {
  enum State: String {
    case idle, requestingAuthorization, starting, running, stopping, ended, failed
  }

  @Published private(set) var state: State = .idle
  @Published private(set) var heartRate: Double?
  @Published private(set) var heartRateAt: Date?
  @Published private(set) var mirroring = false
  @Published private(set) var lastError: String?

  private let healthStore = HKHealthStore()
  private var session: HKWorkoutSession?
  private var builder: HKLiveWorkoutBuilder?
  private let encoder = JSONEncoder()

  var isRunning: Bool {
    state == .starting || state == .running
  }

  func start() {
    guard HKHealthStore.isHealthDataAvailable() else {
      fail("HealthKit indisponível neste relógio")
      return
    }
    lastError = nil
    state = .requestingAuthorization

    let typesToRead: Set<HKObjectType> = [
      HKQuantityType(.heartRate),
      HKQuantityType(.activeEnergyBurned),
      HKQuantityType(.stepCount),
    ]
    let typesToShare: Set<HKSampleType> = [HKWorkoutType.workoutType()]

    healthStore.requestAuthorization(toShare: typesToShare, read: typesToRead) { [weak self] granted, error in
      Task { @MainActor in
        guard let self else { return }
        if let error {
          self.fail(error.localizedDescription)
          return
        }
        guard granted else {
          self.fail("Autorização do HealthKit negada")
          return
        }
        self.beginSession()
      }
    }
  }

  func stop() {
    guard let session else { return }
    state = .stopping
    // Segue a amostra oficial da Apple: parar a atividade e chamar end()
    // somente quando a sessao reportar .stopped (ver delegate abaixo).
    session.stopActivity(with: Date())
  }

  private func beginSession() {
    let configuration = HKWorkoutConfiguration()
    configuration.activityType = .other
    configuration.locationType = .indoor

    do {
      let session = try HKWorkoutSession(healthStore: healthStore, configuration: configuration)
      let builder = session.associatedWorkoutBuilder()
      builder.dataSource = HKLiveWorkoutDataSource(healthStore: healthStore, workoutConfiguration: configuration)
      session.delegate = self
      builder.delegate = self
      self.session = session
      self.builder = builder
      state = .starting

      let startDate = Date()
      session.startMirroringToCompanionDevice { [weak self] success, error in
        Task { @MainActor in
          self?.mirroring = success
          if let error {
            self?.lastError = "Espelhamento: \(error.localizedDescription)"
          }
        }
      }
      session.startActivity(with: startDate)
      builder.beginCollection(withStart: startDate) { [weak self] _, error in
        Task { @MainActor in
          if let error {
            self?.fail(error.localizedDescription)
          }
        }
      }
    } catch {
      fail(error.localizedDescription)
    }
  }

  private func finishBuilder() {
    guard let builder else {
      state = .ended
      return
    }
    builder.endCollection(withEnd: Date()) { [weak self] _, _ in
      builder.finishWorkout { _, _ in
        Task { @MainActor in
          guard let self else { return }
          self.state = .ended
          self.mirroring = false
          self.session = nil
          self.builder = nil
        }
      }
    }
  }

  private func fail(_ message: String) {
    lastError = message
    state = .failed
  }

  private func mirror(bpm: Double, at date: Date) {
    guard let session else { return }
    let payload = MirroredPayload(
      type: "heartRate",
      bpm: bpm,
      measuredAt: ISO8601DateFormatter.swi.string(from: date)
    )
    guard let data = try? encoder.encode(payload) else { return }
    session.sendToRemoteWorkoutSession(data: data) { [weak self] _, error in
      if let error {
        Task { @MainActor in
          self?.lastError = "Envio: \(error.localizedDescription)"
        }
      }
    }
  }
}

/// Mesmo contrato decodificado por MirroredWorkoutReceiver no iPhone.
struct MirroredPayload: Encodable {
  let type: String
  let bpm: Double?
  let measuredAt: String
}

extension ISO8601DateFormatter {
  static let swi: ISO8601DateFormatter = {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return formatter
  }()
}

extension WorkoutCollector: HKWorkoutSessionDelegate {
  nonisolated func workoutSession(
    _ workoutSession: HKWorkoutSession,
    didChangeTo toState: HKWorkoutSessionState,
    from fromState: HKWorkoutSessionState,
    date: Date
  ) {
    Task { @MainActor in
      switch toState {
      case .running:
        self.state = .running
      case .stopped:
        workoutSession.end()
      case .ended:
        self.finishBuilder()
      default:
        break
      }
    }
  }

  nonisolated func workoutSession(_ workoutSession: HKWorkoutSession, didFailWithError error: Error) {
    Task { @MainActor in
      self.fail(error.localizedDescription)
    }
  }
}

extension WorkoutCollector: HKLiveWorkoutBuilderDelegate {
  nonisolated func workoutBuilderDidCollectEvent(_ workoutBuilder: HKLiveWorkoutBuilder) {}

  nonisolated func workoutBuilder(
    _ workoutBuilder: HKLiveWorkoutBuilder,
    didCollectDataOf collectedTypes: Set<HKSampleType>
  ) {
    let heartRateType = HKQuantityType(.heartRate)
    guard
      collectedTypes.contains(heartRateType),
      let statistics = workoutBuilder.statistics(for: heartRateType),
      let quantity = statistics.mostRecentQuantity()
    else { return }

    let bpm = quantity.doubleValue(for: HKUnit.count().unitDivided(by: .minute()))
    let measuredAt = statistics.mostRecentQuantityDateInterval()?.end ?? Date()

    Task { @MainActor in
      self.heartRate = bpm
      self.heartRateAt = measuredAt
      self.mirror(bpm: bpm, at: measuredAt)
    }
  }
}
