import CoreMotion
import Foundation

/// Perfil de contagem de movimento do piloto. Mudar qualquer valor muda o
/// significado da serie inteira de motionCount no backend, que nao guarda com
/// que limiar contou. Trocar exige nome novo de perfil.
enum MotionProfile {
  static let name = "swi-motion-experimental-1"
  /// 20 Hz. Menos perde pico curto; mais custa bateria sem ganho para contar.
  static let updateInterval: TimeInterval = 1.0 / 20.0
  /// Em g. Aceleracao do usuario, com a gravidade ja removida pelo sistema.
  static let peakThresholdG: Double = 0.3
  /// Intervalo minimo entre picos: uma bracada nao vira tres.
  static let refractory: TimeInterval = 0.25
}

/// Conta picos de aceleracao linear acima do limiar. `drain()` devolve quantos
/// desde a ultima drenagem: e a variacao de movimento de um evento, e zero e
/// contagem, nao ausencia. Sem acelerometro, `available` fica false e nada e
/// inventado; cadencia de passos NAO substitui movimento.
///
/// As atualizacoes chegam numa fila propria, nao na principal: 20 por segundo
/// na tela pesariam. So o estado protegido pela trava e tocado nessa fila;
/// `available` e `running` sao lidos e escritos pelo chamador, no ator
/// principal.
final class MotionCounter: @unchecked Sendable {
  private let manager = CMMotionManager()
  private let queue: OperationQueue = {
    let queue = OperationQueue()
    queue.name = "com.kavicki.swi.motion"
    queue.maxConcurrentOperationCount = 1
    return queue
  }()
  private let lock = NSLock()
  private var count = 0
  private var lastPeakAt: TimeInterval = -.infinity
  private var above = false

  private(set) var available = false
  private(set) var running = false

  func start() {
    guard manager.isDeviceMotionAvailable else {
      available = false
      return
    }
    available = true
    running = true
    manager.deviceMotionUpdateInterval = MotionProfile.updateInterval
    manager.startDeviceMotionUpdates(to: queue) { [weak self] motion, _ in
      guard let self, let motion else { return }
      self.observe(motion.userAcceleration, at: motion.timestamp)
    }
  }

  func stop() {
    manager.stopDeviceMotionUpdates()
    // `available` cai junto: um retorno atrasado do builder depois daqui nao
    // pode drenar um sensor parado e escrever zero como se fosse contagem.
    available = false
    running = false
    lock.lock()
    count = 0
    above = false
    lastPeakAt = -.infinity
    lock.unlock()
  }

  /// Picos acumulados, sem zerar. Espiar e consumir sao separados pelo mesmo
  /// motivo que no rastreador de variacao: quem chama monta o evento entre os
  /// dois, e falha ao enfileirar nao pode fazer os picos sumirem.
  func peekCount() -> Int {
    lock.lock()
    defer { lock.unlock() }
    return count
  }

  /// Desconta o que ja entrou num evento gravado. Desconta, e nao zera: picos
  /// contados entre espiar e consumir ficam para o evento seguinte.
  func consume(_ amount: Int) {
    guard amount > 0 else { return }
    lock.lock()
    defer { lock.unlock() }
    count = max(0, count - amount)
  }

  /// Um pico e a subida acima do limiar, contada uma vez ate descer de novo,
  /// e nunca antes do intervalo minimo desde o pico anterior.
  private func observe(_ acceleration: CMAcceleration, at timestamp: TimeInterval) {
    let magnitude = (
      acceleration.x * acceleration.x
        + acceleration.y * acceleration.y
        + acceleration.z * acceleration.z
    ).squareRoot()
    let isAbove = magnitude >= MotionProfile.peakThresholdG
    lock.lock()
    defer { lock.unlock() }
    if isAbove, !above, timestamp - lastPeakAt >= MotionProfile.refractory {
      count += 1
      lastPeakAt = timestamp
    }
    above = isAbove
  }
}
