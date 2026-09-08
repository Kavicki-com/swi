import Combine
import Foundation
import HealthKit
import WatchKit

/// Coletor da sessao de monitoramento. Mantem uma HKWorkoutSession espelhada
/// para o iPhone, le batimento, passos, energia, movimento e bateria, numera
/// cada leitura, guarda na fila e espelha em remessas confirmadas.
///
/// A ordem de tres passos aparece em todo lugar aqui e nao pode inverter:
/// ESPIAR o que sairia, GRAVAR na fila, e so entao CONFIRMAR os contadores.
/// Confirmar antes de gravar perde a leitura quando a gravacao falha.
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
  /// Numa sessao retomada eles recomecam do zero, e a tela avisa.
  @Published private(set) var steps = 0
  @Published private(set) var activeEnergyKcal = 0.0
  @Published private(set) var lastStepVariation: Int?
  @Published private(set) var lastEnergyVariation: Double?
  /// Picos por minuto do ultimo intervalo, so para a tela. O que vai no evento
  /// e a contagem desde o evento anterior, nunca esta taxa.
  @Published private(set) var motionPerMinute: Double?
  @Published private(set) var motionAvailable = false
  /// Ausencia e nil, nunca zero.
  @Published private(set) var batteryPercent: Double?
  @Published private(set) var mirroring = false
  @Published private(set) var lastError: String?
  /// Estado da fila, para a tela do piloto.
  @Published private(set) var pendingCount = 0
  @Published private(set) var discarded = 0
  @Published private(set) var lastAcknowledgedBatch: Int?
  /// Sessao retomada depois de o sistema encerrar o app do relogio. A fila e a
  /// sequencia continuam; os totais da tela recomecam.
  @Published private(set) var resumed = false

  private let healthStore = HKHealthStore()
  private var session: HKWorkoutSession?
  private var builder: HKLiveWorkoutBuilder?
  private let motion = MotionCounter()
  private let outbox = WatchOutbox()
  private var transport: MirrorTransport?
  private var stepTracker = VariationTracker()
  private var energyTracker = VariationTracker()
  private var stepsAccumulated = 0.0
  private var lastMotionDrainAt: Date?
  private var batteryTimer: Timer?
  /// Bateria entra no proximo evento, e nao num evento so dela: uma leitura a
  /// cada 3 minutos nao justifica um evento proprio.
  private var batteryToSend: Double?

  var isRunning: Bool {
    state == .starting || state == .running
  }

  // MARK: - Ciclo de vida

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

  /// Retomada. O sistema pode encerrar o app do relogio com a sessao ainda
  /// ativa; nesse caso o HealthKit devolve a MESMA sessao, e o identificador
  /// dela esta no estado da fila. Sem isto, cada morte de processo abriria
  /// sessao nova no backend e quebraria a cadeia de esforco e desgaste.
  func resumeIfPossible() {
    guard !isRunning, HKHealthStore.isHealthDataAvailable() else { return }
    healthStore.recoverActiveWorkoutSession { [weak self] recovered, _ in
      Task { @MainActor in
        guard let self, let recovered, !self.isRunning else { return }
        self.attach(recovered)
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
      startSensors(at: startDate, sessionId: UUID().uuidString.lowercased(), resuming: false)
    } catch {
      fail(error.localizedDescription)
    }
  }

  private func attach(_ recovered: HKWorkoutSession) {
    let builder = recovered.associatedWorkoutBuilder()
    recovered.delegate = self
    builder.delegate = self
    session = recovered
    self.builder = builder
    state = recovered.state == .running ? .running : .starting
    mirroring = true
    // Sem identificador gravado nao ha o que retomar: a fila comeca limpa, e
    // inventar um identificador novo para uma sessao antiga seria pior.
    let sessionId = outbox.storedSessionId ?? UUID().uuidString.lowercased()
    startSensors(at: Date(), sessionId: sessionId, resuming: outbox.storedSessionId != nil)
  }

  /// Sessao nova, bases novas. Sessao retomada, bases vindas da fila.
  private func startSensors(at startDate: Date, sessionId: String, resuming: Bool) {
    do {
      try outbox.open(sessionId: sessionId)
    } catch {
      lastError = "Fila: \(error.localizedDescription)"
    }
    resumed = resuming
    stepTracker = VariationTracker(base: resuming ? outbox.state.stepBase : 0)
    energyTracker = VariationTracker(base: resuming ? outbox.state.energyBase : 0)
    // Totais da tela nao sobrevivem a retomada: eles sao a soma das variacoes
    // desta execucao, e a comparacao com o app Fitness so vale numa sessao que
    // nao foi interrompida. A tela diz quando foi retomada.
    steps = 0
    stepsAccumulated = 0
    activeEnergyKcal = 0
    heartRate = nil
    heartRateAt = nil
    lastStepVariation = nil
    lastEnergyVariation = nil
    motionPerMinute = nil
    lastMotionDrainAt = startDate

    transport = MirrorTransport(outbox: outbox) { [weak self] payload, completion in
      guard let session = self?.session else {
        completion(false)
        return
      }
      session.sendToRemoteWorkoutSession(data: payload) { accepted, _ in
        completion(accepted)
      }
    }
    refreshQueueCounters()

    motion.start()
    motionAvailable = motion.available

    readBattery()
    batteryTimer?.invalidate()
    batteryTimer = Timer.scheduledTimer(withTimeInterval: Self.batteryInterval, repeats: true) { [weak self] _ in
      Task { @MainActor in
        self?.readBattery()
      }
    }
    // Um acumulo pode ter sobrado da execucao anterior.
    transport?.pump()
  }

  private func stopSensors() {
    motion.stop()
    motionAvailable = false
    batteryTimer?.invalidate()
    batteryTimer = nil
    transport?.stop()
  }

  private func readBattery() {
    let device = WKInterfaceDevice.current()
    device.isBatteryMonitoringEnabled = true
    let level = device.batteryLevel
    // -1 e "desconhecido". Ausencia nunca vira zero.
    guard level >= 0 else { return }
    let percent = Double(level) * 100
    batteryPercent = percent
    batteryToSend = percent
  }

  // MARK: - Coleta

  /// Um retorno do builder, ja no ator principal. Espia todas as variacoes,
  /// grava um evento com o que houver, e so entao confirma os contadores.
  private func collect(_ reading: BuilderReading) {
    var measurements = TelemetryMeasurements()

    if let bpm = reading.bpm {
      measurements.heartRate = .heartRate(bpm: bpm)
    }

    // Passos: o inteiro sai da diferenca entre arredondamentos do acumulado,
    // e nao do arredondamento da variacao, para a soma dos inteiros nunca
    // divergir do total do HealthKit.
    var nextStepsAccumulated = stepsAccumulated
    var stepWhole = 0
    if let cumulative = reading.stepsCumulative,
      let variation = stepTracker.peek(cumulative: cumulative)
    {
      nextStepsAccumulated = stepsAccumulated + variation
      stepWhole = Int(nextStepsAccumulated.rounded()) - steps
      if stepWhole > 0 {
        measurements.stepDelta = .steps(stepWhole)
      }
    }

    var energyVariation: Double?
    if let cumulative = reading.energyCumulative,
      let variation = energyTracker.peek(cumulative: cumulative)
    {
      energyVariation = variation
      measurements.activeEnergyKcal = .energy(kcal: variation)
    }

    var peaks = 0
    var motionMinutes: Double?
    if motion.available, let since = lastMotionDrainAt {
      let minutes = reading.at.timeIntervalSince(since) / 60
      if minutes > 0 {
        peaks = motion.peekCount()
        motionMinutes = minutes
        // Zero picos num intervalo e CONTAGEM, nao ausencia: o backend divide
        // a contagem pelo intervalo desde o evento anterior, e omitir aqui
        // faria parado virar buraco em vez de repouso.
        measurements.motionCount = .motion(peaks: peaks)
      }
    }

    if let percent = batteryToSend {
      measurements.battery = .battery(percent: percent)
    }

    // Nada medido, nada a gravar. Os rastreadores nao avancam, e a variacao
    // reaparece inteira no proximo retorno.
    guard !measurements.isEmpty else { return }

    do {
      try outbox.append(
        measurements: measurements,
        at: reading.at,
        stepBase: reading.stepsCumulative ?? stepTracker.base,
        energyBase: reading.energyCumulative ?? energyTracker.base
      )
    } catch {
      lastError = "Fila: \(error.localizedDescription)"
      return
    }

    // Gravado. So agora os contadores andam.
    if let bpm = reading.bpm, let bpmAt = reading.bpmAt {
      heartRate = bpm
      heartRateAt = bpmAt
    }
    if let cumulative = reading.stepsCumulative {
      stepTracker.commit(cumulative: cumulative)
      stepsAccumulated = nextStepsAccumulated
      if stepWhole > 0 {
        lastStepVariation = stepWhole
        steps += stepWhole
      }
    }
    if let cumulative = reading.energyCumulative {
      energyTracker.commit(cumulative: cumulative)
      if let variation = energyVariation {
        lastEnergyVariation = variation
        activeEnergyKcal += variation
      }
    }
    if let minutes = motionMinutes {
      motion.consume(peaks)
      motionPerMinute = Double(peaks) / minutes
      lastMotionDrainAt = reading.at
    }
    batteryToSend = nil

    refreshQueueCounters()
    transport?.pump()
  }

  private func refreshQueueCounters() {
    pendingCount = outbox.pendingCount
    discarded = outbox.discarded
    lastAcknowledgedBatch = transport?.lastAcknowledgedBatch
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

  /// O canal e nos dois sentidos: aqui chegam as confirmacoes do iPhone.
  nonisolated func workoutSession(
    _ workoutSession: HKWorkoutSession,
    didReceiveDataFromRemoteWorkoutSession data: [Data]
  ) {
    let lines = data.compactMap { String(data: $0, encoding: .utf8) }
    Task { @MainActor in
      for line in lines {
        self.transport?.handle(line: line)
      }
      self.refreshQueueCounters()
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
