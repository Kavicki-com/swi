import Foundation
import SwiftUI

/// Superficie de piloto: estado da sessao, as leituras, e ativar/encerrar.
/// Quem faz o teste em hardware esta com o relogio no pulso, entao os numeros
/// de verificacao moram aqui. Sai quando o piloto sair.
struct ContentView: View {
  @EnvironmentObject private var collector: WorkoutCollector

  var body: some View {
    ScrollView {
      VStack(spacing: 6) {
        Text("SWI")
          .font(.headline)

        Text(statusLabel)
          .font(.caption)
          .foregroundStyle(.secondary)

        if let bpm = collector.heartRate {
          Text("\(Int(bpm.rounded()))")
            .font(.system(size: 36, weight: .bold, design: .rounded))
          Text("bpm")
            .font(.caption2)
        } else {
          Text("Sem batimento ainda")
            .font(.caption)
        }

        Divider()

        // Agrupadas de proposito: o ViewBuilder do SwiftUI aceita no maximo 10
        // filhos, e soltas elas levariam este VStack a 11. Group e transparente
        // para o layout, entao o spacing continua valendo entre elas.
        Group {
          reading("Passos", "\(collector.steps)", detail: collector.lastStepVariation.map { "+\($0)" })
          reading(
            "Energia",
            String(format: "%.1f kcal", collector.activeEnergyKcal),
            detail: collector.lastEnergyVariation.map { String(format: "+%.2f", $0) }
          )
          reading("Movimento", motionLabel, detail: nil)
          reading("Bateria", batteryLabel, detail: nil)
        }

        // Segundo Group pelo mesmo motivo do primeiro: o ViewBuilder aceita 10
        // filhos, e estas tres soltas estourariam de novo.
        Group {
          reading("Na fila", "\(collector.pendingCount)", detail: nil)
          reading("Descartados", "\(collector.discarded)", detail: nil)
          reading("Última remessa", remessaLabel, detail: nil)
        }

        // Terceiro Group: com estas tres soltas o VStack chegaria a 10 filhos,
        // o limite exato do ViewBuilder, sem folga para a proxima linha.
        Group {
          Text(collector.mirroring ? "Espelhando para o iPhone" : "Sem espelhamento")
            .font(.caption2)
            .foregroundStyle(collector.mirroring ? Color.green : Color.secondary)

          if collector.resumed {
            Text("Sessão retomada: totais recomeçaram")
              .font(.caption2)
              .foregroundStyle(.secondary)
              .multilineTextAlignment(.center)
          }

          if let error = collector.lastError {
            Text(error)
              .font(.caption2)
              .foregroundStyle(.red)
              .multilineTextAlignment(.center)
          }
        }

        if collector.isRunning {
          Button("Encerrar monitoramento", role: .destructive) {
            collector.stop()
          }
        } else {
          Button("Ativar monitoramento") {
            collector.start()
          }
        }
      }
      .padding(.horizontal, 4)
    }
  }

  private func reading(_ label: String, _ value: String, detail: String?) -> some View {
    HStack {
      Text(label)
        .font(.caption2)
        .foregroundStyle(.secondary)
      Spacer()
      if let detail {
        Text(detail)
          .font(.caption2)
          .foregroundStyle(.secondary)
      }
      Text(value)
        .font(.caption)
        .monospacedDigit()
    }
  }

  /// Ausencia e dita como ausencia. "Sem acelerometro" e um fato do aparelho;
  /// "aguardando" e a sessao que ainda nao drenou nenhum intervalo.
  private var motionLabel: String {
    guard collector.motionAvailable else { return "sem acelerômetro" }
    guard let perMinute = collector.motionPerMinute else { return "aguardando" }
    return String(format: "%.0f/min", perMinute)
  }

  /// Sem remessa confirmada ainda e um estado legitimo no comeco da sessao.
  private var remessaLabel: String {
    guard let batch = collector.lastAcknowledgedBatch else { return "nenhuma" }
    return "#\(batch)"
  }

  private var batteryLabel: String {
    guard let percent = collector.batteryPercent else { return "desconhecida" }
    return String(format: "%.0f%%", percent)
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
