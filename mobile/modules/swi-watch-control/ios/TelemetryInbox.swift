import Foundation

/// Arquivo duravel de telemetria no iPhone. Recebe as linhas que o relogio
/// manda, anexa e sincroniza. Nao interpreta nada: nao sabe o que e batimento,
/// nao valida evento, nao fala com o backend. Quem le e o JavaScript, quando
/// estiver rodando.
///
/// Existe por causa de um fato do iOS: o JavaScript nao roda com o app em
/// segundo plano, e as leituras que o Swift recebe nesse periodo morriam. Este
/// arquivo e o ponto em que a leitura para de depender de haver JavaScript
/// vivo.
///
/// **Quem rotaciona e este arquivo, nunca o JavaScript.** A ideia obvia, de o
/// JavaScript renomear e drenar o renomeado, tem uma corrida de microssegundos:
/// o Swift pode escrever num arquivo que o JavaScript ja leu e vai apagar,
/// perdendo um evento QUE JA FOI CONFIRMADO ao relogio. Aqui o Swift fecha o
/// arquivo atual, abre o proximo numero e devolve os fechados; o JavaScript so
/// toca em arquivo que ninguem mais escreve.
final class TelemetryInbox {
  static let shared = TelemetryInbox()

  private let prefix = "telemetry-inbox."
  private let suffix = ".ndjson"
  private let queue = DispatchQueue(label: "com.kavicki.swi.inbox")
  private let fileManager = FileManager.default
  private var current: Int?

  /// A mesma pasta da fila do JavaScript: sobrevive a reinicio e o sistema nao
  /// a limpa sob pressao de espaco, ao contrario de `cache`.
  private var directory: URL {
    fileManager.urls(for: .documentDirectory, in: .userDomainMask)[0]
  }

  private func url(for index: Int) -> URL {
    directory.appendingPathComponent("\(prefix)\(index)\(suffix)")
  }

  /// Os numeros ja existentes na pasta, em ordem.
  private func existingIndexes() -> [Int] {
    let names = (try? fileManager.contentsOfDirectory(atPath: directory.path)) ?? []
    return names.compactMap { name in
      guard name.hasPrefix(prefix), name.hasSuffix(suffix) else { return nil }
      let middle = name.dropFirst(prefix.count).dropLast(suffix.count)
      return Int(middle)
    }.sorted()
  }

  /// Anexa as linhas e sincroniza. O booleano e o que autoriza a confirmacao ao
  /// relogio: sem sincronizar, confirmar seria mentir sobre durabilidade, e o
  /// relogio apagaria da fila dele algo que um corte de energia levaria embora.
  func append(lines: [String]) -> Bool {
    guard !lines.isEmpty else { return true }
    return queue.sync {
      let index = current ?? (existingIndexes().last ?? 0)
      current = index
      let target = url(for: index)
      if !fileManager.fileExists(atPath: target.path) {
        fileManager.createFile(atPath: target.path, contents: nil)
      }
      guard let handle = try? FileHandle(forWritingTo: target) else { return false }
      defer { try? handle.close() }
      let text = lines.joined(separator: "\n") + "\n"
      guard let data = text.data(using: .utf8) else { return false }
      do {
        try handle.seekToEnd()
        try handle.write(contentsOf: data)
        try handle.synchronize()
        return true
      } catch {
        return false
      }
    }
  }

  /// Fecha o arquivo corrente, passa a escrever no proximo numero, e devolve as
  /// URIs `file://` dos que o Swift nunca mais vai tocar. O JavaScript le e
  /// apaga esses, e so esses.
  func rotate() -> [String] {
    queue.sync {
      let indexes = existingIndexes()
      guard !indexes.isEmpty else {
        current = nil
        return []
      }
      current = (indexes.last ?? 0) + 1
      return indexes.map { url(for: $0).absoluteString }
    }
  }

  /// Quantos arquivos esperam o dreno. Vai para a tela de diagnostico.
  var pendingFileCount: Int {
    queue.sync { existingIndexes().count }
  }
}
