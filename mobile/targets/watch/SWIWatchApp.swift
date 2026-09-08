import HealthKit
import SwiftUI
import WatchKit

@main
struct SWIWatchApp: App {
  // O adaptor instala o delegate no launch. Sem ele o sistema nao tem a quem
  // entregar a sessao que o iPhone abre com startWatchApp(toHandle:): o app do
  // relogio acordaria e nada comecaria.
  @WKApplicationDelegateAdaptor(SWIWatchAppDelegate.self) private var delegate

  var body: some Scene {
    WindowGroup {
      // O body do App e isolado no MainActor, entao ler o coletor unico aqui e
      // seguro, e a tela opera a mesma sessao que o delegate recebe.
      ContentView()
        .environmentObject(WorkoutCollector.shared)
    }
  }
}

/// Recebe a sessao de monitoramento iniciada pelo iPhone.
///
/// Autorizar e ativar sao acoes distintas (ADR-0003): o iPhone autoriza o
/// HealthKit e depois pede a ativacao, que chega aqui.
///
/// A classe e isolada no MainActor para chamar o coletor direto. Passar a
/// HKWorkoutConfiguration por um Task cruzaria fronteira de ator com um tipo
/// que nao e Sendable.
@MainActor
final class SWIWatchAppDelegate: NSObject, WKApplicationDelegate {
  func handle(_ workoutConfiguration: HKWorkoutConfiguration) {
    WorkoutCollector.shared.start(configuration: workoutConfiguration)
  }

  /// O sistema pode ter encerrado este app com a sessao ainda ativa. Perguntar
  /// ao HealthKit no arranque e o que retoma a mesma sessao, com a mesma fila e
  /// a mesma sequencia, em vez de abrir uma sessao nova no backend.
  func applicationDidFinishLaunching() {
    WorkoutCollector.shared.resumeIfPossible()
  }
}
