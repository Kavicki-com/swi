import Combine
import Foundation
import HealthKit
import WatchKit

/// Coletor da sessao de monitoramento. Mantem uma HKWorkoutSession espelhada
/// para o iPhone, le batimento, passos, energia, movimento e bateria, e mostra
/// tudo na tela do relogio. Build 1 da Task 9: o espelhamento continua so com
/// batimento, no formato de hoje; a fila e a remessa vem na build 2.
@MainActor
final class WorkoutCollector: NSObject, ObservableObject {
  enum State: String {
    case idle, requestingAuthorization, starting, running, stopping, ended, failed
  }

  /// Instancia unica. O delegate do relogio (sessao vinda do iPhone) e a tela
  /// precisam operar a mesma sessao; duas instancias dariam dois monitoramentos.
  static let shared = WorkoutCollector()

  /// Bateria a cada 3 minutos: a regua congelada diz "atual ate 5 minutos", e
  /// ler a cada 5 deixaria a leitura na fronteira do desatualizado.
  static let batteryInterval: TimeInterval = 180

  @Published private(set) var state: State = .idle
  @Published private(set) var heartRate: Double?
  @Published private(set) var heartRateAt: Date?
  /// Passos e energia da sessao como SOMA DAS VARIACOES emitidas, e nao o
  /// acumulado do HealthKit. Devem bater com o app Fitness no fim da sessao;
  /// divergencia e defeito do rastreador, e e assim que ele e testado sem Mac.
  @Published private(set) var steps = 0
  @Published private(set) var activeEnergyKcal = 0.0
  @Published private(set) var lastStepVariation: Int?
  @Published private(set) var lastEnergyVariation: Double?
  /// Picos por minuto do ultimo intervalo, so para a tela. O que vai no evento
  /// (build 2) e a contagem desde o evento anterior, nunca esta taxa.
  @Published private(set) var motionPerMinute: Double?
  @Published private(set) var motionAvailable = false
  /// Ausencia e nil, nunca zero.
  @Published private(set) var batteryPercent: Double?
  @Published private(set) var mirroring = false
  @Published private(set) var lastError: String?

  private let healthStore = HKHealthStore()
  private var session: HKWorkoutSession?
  private var builder: HKLiveWorkoutBuilder?
  private let encoder = JSONEncoder()
  private let motion = MotionCounter()
  private var stepTracker = VariationTracker()
  private var energyTracker = VariationTracker()
  private var lastMotionDrainAt: Date?
  private var batteryTimer: Timer?
  /// Acumulado exato dos passos, em Double. `steps` e o arredondamento dele.
  /// Arredondar cada variacao isolada perderia a fracao de cada uma e a soma
  /// dos inteiros deixaria de bater com o acumulado do HealthKit, que e
  /// justamente a identidade usada para validar o rastreador sem Mac.
  private var stepsAccumulated = 0.0

  var isRunning: Bool {
    state == .starting || state == .running
  }

  /// `configuration` chega preenchida quando o iPhone abriu a sessao; nesse caso
  /// e usada como veio, em vez de recriada aqui, para nao divergir do que foi
  /// pedido. O botao do relogio chama sem argumento.
  func start(configuration: HKWorkoutConfiguration? = nil) {
    // O iPhone pode pedir ativacao com a sessao ja rodando. Sem esta guarda,
    // beginSession sobrescreveria session e builder e vazaria a sessao
    // anterior, que continuaria espelhando para o iPhone.
    guard !isRunning else { return }
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
        // `granted` diz que a folha foi RESPONDIDA, nao que houve concessao, e
        // volta false quando o app acorda em background e nao pode apresenta-la.
        // O HealthKit simplesmente nao entrega amostra sem permissao, e ausencia
        // de leitura ja e tratada com honestidade rio abaixo (ADR-0004). Seguir
        // e melhor que abortar afirmando uma negacao que nao foi observada.
        _ = granted
        self.beginSession(with: configuration ?? Self.monitoringConfiguration())
      }
    }
  }

  /// Encerrar: a acao do funcionario. O backend nao e avisado; quem constata o
  /// fim de uma sessao e ele, por silencio.
  func stop() {
    guard let session else { return }
    state = .stopping
    // Segue a amostra oficial da Apple: parar a atividade e chamar end()
    // somente quando a sessao reportar .stopped (ver delegate abaixo).
    session.stopActivity(with: Date())
  }

  /// Sessao tecnica de monitoramento. Aparece no app Fitness como um treino
  /// "Outro" e fecha o anel de exercicio: e o preco do espelhamento oficial,
  /// nao um defeito.
  static func monitoringConfiguration() -> HKWorkoutConfiguration {
    let configuration = HKWorkoutConfiguration()
    configuration.activityType = .other
    configuration.locationType = .indoor
    return configuration
  }

  private func beginSession(with configuration: HKWorkoutConfiguration) {
    do {
      let session = try HKWorkoutSession(healthStore: healthStore, configuration: configuration)
      let builder = session.associatedWorkoutBuilder()
      let dataSource = HKLiveWorkoutDataSource(healthStore: healthStore, workoutConfiguration: configuration)
      // O builder so coleta o que a fonte habilita, e a atividade "Outro" nao
      // garante passos por padrao. Sem estas duas linhas a tela mostraria zero
      // e a culpa cairia no sensor.
      dataSource.enableCollection(for: HKQuantityType(.stepCount), predicate: nil)
      dataSource.enableCollection(for: HKQuantityType(.activeEnergyBurned), predicate: nil)
      builder.dataSource = dataSource
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
      startSensors(at: startDate)
    } catch {
      fail(error.localizedDescription)
    }
  }

  /// Sessao nova, bases novas: a variacao e presa a sessao.
  private func startSensors(at startDate: Date) {
    stepTracker = VariationTracker()
    energyTracker = VariationTracker()
    // Sessao nova nao herda leitura da anterior: mostrar o batimento da sessao
    // passada ate o primeiro retorno do HealthKit seria dado velho sem rotulo.
    heartRate = nil
    heartRateAt = nil
    steps = 0
    stepsAccumulated = 0
    activeEnergyKcal = 0
    lastStepVariation = nil
    lastEnergyVariation = nil
    motionPerMinute = nil
    lastMotionDrainAt = startDate

    motion.start()
    motionAvailable = motion.available

    readBattery()
    batteryTimer?.invalidate()
    batteryTimer = Timer.scheduledTimer(withTimeInterval: Self.batteryInterval, repeats: true) { [weak self] _ in
      Task { @MainActor in
        self?.readBattery()
      }
    }
  }

  private func stopSensors() {
    motion.stop()
    motionAvailable = false
    batteryTimer?.invalidate()
    batteryTimer = nil
  }

  private func readBattery() {
    let device = WKInterfaceDevice.current()
    device.isBatteryMonitoringEnabled = true
    let level = device.batteryLevel
    // -1 e "desconhecido". Ausencia nunca vira zero.
    batteryPercent = level < 0 ? nil : Double(level) * 100
  }

  /// Um retorno do builder, ja no ator principal. Cada medicao presente vira
  /// leitura; movimento e drenado em TODO retorno enquanto o acelerometro
  /// entrega, porque o backend divide a contagem pelo intervalo desde o evento
  /// anterior, qualquer evento.
  private func collect(_ reading: BuilderReading) {
    if let bpm = reading.bpm, let bpmAt = reading.bpmAt {
      heartRate = bpm
      heartRateAt = bpmAt
      mirror(bpm: bpm, at: bpmAt)
    }
    if let cumulative = reading.stepsCumulative,
      let variation = stepTracker.observe(cumulative: cumulative)
    {
      stepsAccumulated += variation
      // O inteiro sai da diferenca entre os arredondamentos, nao do
      // arredondamento da variacao: assim `steps` acompanha o acumulado.
      let whole = Int(stepsAccumulated.rounded()) - steps
      lastStepVariation = whole
      steps += whole
    }
    if let cumulative = reading.energyCumulative,
      let variation = energyTracker.observe(cumulative: cumulative)
    {
      lastEnergyVariation = variation
      activeEnergyKcal += variation
    }
    // O intervalo e conferido ANTES de drenar: drenar e descobrir que o
    // intervalo nao serve jogaria os picos fora. Sem intervalo util, eles
    // ficam no contador e entram na proxima leitura.
    if motion.available, let since = lastMotionDrainAt {
      let minutes = reading.at.timeIntervalSince(since) / 60
      if minutes > 0 {
        motionPerMinute = Double(motion.drain()) / minutes
        lastMotionDrainAt = reading.at
      }
    }
  }

  private func finishBuilder() {
    stopSensors()
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
    stopSensors()
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

/// Uma passada do builder, ja fechada em valores imutaveis. Existe para cruzar
/// a fronteira de concorrencia: `var` local capturado dentro de um Task e erro
/// de compilacao ("reference to captured var in concurrently-executing code").
private struct BuilderReading: Sendable {
  let bpm: Double?
  let bpmAt: Date?
  let stepsCumulative: Double?
  let energyCumulative: Double?
  let at: Date
}

/// Mesmo contrato decodificado por MirroredWorkoutReceiver no iPhone. Nao muda
/// nesta build: o iPhone continua entendendo o que o relogio manda.
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

  /// Le as estatisticas ainda fora do ator (o builder nao e Sendable e e daqui
  /// que ele fala) e cruza para o ator principal so com numeros e datas.
  nonisolated func workoutBuilder(
    _ workoutBuilder: HKLiveWorkoutBuilder,
    didCollectDataOf collectedTypes: Set<HKSampleType>
  ) {
    let heartRateType = HKQuantityType(.heartRate)
    let stepType = HKQuantityType(.stepCount)
    let energyType = HKQuantityType(.activeEnergyBurned)

    var bpm: Double?
    var bpmAt: Date?
    if collectedTypes.contains(heartRateType),
      let statistics = workoutBuilder.statistics(for: heartRateType),
      let quantity = statistics.mostRecentQuantity()
    {
      bpm = quantity.doubleValue(for: HKUnit.count().unitDivided(by: .minute()))
      bpmAt = statistics.mostRecentQuantityDateInterval()?.end ?? Date()
    }

    var stepsCumulative: Double?
    if collectedTypes.contains(stepType),
      let quantity = workoutBuilder.statistics(for: stepType)?.sumQuantity()
    {
      stepsCumulative = quantity.doubleValue(for: HKUnit.count())
    }

    var energyCumulative: Double?
    if collectedTypes.contains(energyType),
      let quantity = workoutBuilder.statistics(for: energyType)?.sumQuantity()
    {
      energyCumulative = quantity.doubleValue(for: HKUnit.kilocalorie())
    }

    let reading = BuilderReading(
      bpm: bpm,
      bpmAt: bpmAt,
      stepsCumulative: stepsCumulative,
      energyCumulative: energyCumulative,
      at: Date()
    )
    Task { @MainActor in
      self.collect(reading)
    }
  }
}
