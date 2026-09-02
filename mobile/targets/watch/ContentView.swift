import SwiftUI

/// Superficie minima do gate tecnico: iniciar/parar a sessao, ver o BPM real
/// e saber se o espelhamento para o iPhone esta ativo.
struct ContentView: View {
  @EnvironmentObject private var collector: WorkoutCollector

  var body: some View {
    ScrollView {
      VStack(spacing: 8) {
        Text("SWI")
          .font(.headline)

        Text(statusLabel)
          .font(.caption)
          .foregroundStyle(.secondary)

        if let bpm = collector.heartRate {
          Text("\(Int(bpm.rounded()))")
            .font(.system(size: 40, weight: .bold, design: .rounded))
          Text("bpm")
            .font(.caption)
        } else {
          Text("Sem BPM ainda")
            .font(.caption)
        }

        Text(collector.mirroring ? "Espelhando para o iPhone" : "Sem espelhamento")
          .font(.caption2)
          .foregroundStyle(collector.mirroring ? .green : .secondary)

        if let error = collector.lastError {
          Text(error)
            .font(.caption2)
            .foregroundStyle(.red)
            .multilineTextAlignment(.center)
        }

        if collector.isRunning {
          Button("Parar teste", role: .destructive) {
            collector.stop()
          }
        } else {
          Button("Iniciar teste") {
            collector.start()
          }
        }
      }
      .padding(.horizontal, 4)
    }
  }

  private var statusLabel: String {
    switch collector.state {
    case .idle: return "Pronto"
    case .requestingAuthorization: return "Pedindo autorização"
    case .starting: return "Iniciando sessão"
    case .running: return "Sessão ativa"
    case .stopping: return "Encerrando"
    case .ended: return "Sessão encerrada"
    case .failed: return "Falhou"
    }
  }
}
