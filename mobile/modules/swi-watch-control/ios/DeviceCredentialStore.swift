import Foundation
import Security

/// Guarda a credencial do aparelho no chaveiro do iOS.
///
/// Por que o chaveiro e nao o armazenamento do Expo: a credencial autentica o
/// envio de telemetria e nunca pode passar pelo JavaScript, nem em memoria nem
/// em armazenamento. O SecureStore do Expo e legivel por qualquer codigo JS e
/// por qualquer biblioteca do app; um item do chaveiro com servico e conta
/// proprios so e lido por quem conhece os dois nomes, e eles vivem aqui.
///
/// Por que `ThisDeviceOnly`: a credencial e do aparelho, nao do funcionario.
/// Ela nao migra por backup nem por transferencia para um iPhone novo; o
/// caminho correto e revogar no painel e parear de novo.
///
/// `AfterFirstUnlock` porque o envio pode acontecer com a tela bloqueada, e o
/// item precisa estar legivel depois do primeiro desbloqueio apos o boot.
enum DeviceCredentialStore {
  /// Erro proprio para o JavaScript saber que o pareamento NAO pode ser dado
  /// como concluido: a resposta chegou, mas a credencial nao foi guardada.
  struct KeychainError: LocalizedError {
    let status: OSStatus

    var errorDescription: String? {
      return "Chaveiro recusou a gravacao da credencial (OSStatus \(status))"
    }
  }

  private static let service = "com.kavicki.swi.telemetry"
  private static let account = "device-credential"

  /// Consulta que identifica o item. As mesmas chaves servem para ler, apagar
  /// e gravar, para que nunca haja dois itens com nomes ligeiramente diferentes.
  private static var baseQuery: [String: Any] {
    return [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrAccount as String: account,
    ]
  }

  /// Devolve a credencial guardada, ou nil em qualquer erro ou ausencia. Quem
  /// chama nao distingue os dois casos de proposito: sem credencial legivel,
  /// o aparelho nao esta pareado.
  static func read() -> String? {
    var query = baseQuery
    query[kSecReturnData as String] = true
    query[kSecMatchLimit as String] = kSecMatchLimitOne

    var item: CFTypeRef?
    let status = SecItemCopyMatching(query as CFDictionary, &item)
    guard status == errSecSuccess else {
      return nil
    }
    guard let data = item as? Data else {
      return nil
    }
    return String(data: data, encoding: .utf8)
  }

  /// Apaga o item existente antes de gravar, em vez de usar SecItemUpdate: a
  /// sequencia apagar e adicionar tem um caminho so, e um pareamento novo
  /// substitui o anterior sem depender do item existir ou nao.
  static func write(_ credential: String) throws {
    // errSecItemNotFound aqui e o caso normal do primeiro pareamento. Qualquer
    // outra falha de apagar reaparece no SecItemAdd como errSecDuplicateItem,
    // e e la que ela e tratada.
    _ = SecItemDelete(baseQuery as CFDictionary)

    var query = baseQuery
    query[kSecValueData as String] = Data(credential.utf8)
    query[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly

    let status = SecItemAdd(query as CFDictionary, nil)
    // Duplicado e sucesso: duas conclusoes de pareamento simultaneas podem
    // intercalar apagar e adicionar, e a segunda encontra o item que a
    // primeira acabou de gravar. A credencial esta la; e isso que importa.
    guard status == errSecSuccess || status == errSecDuplicateItem else {
      throw KeychainError(status: status)
    }
  }

  /// Remove a credencial. Ausencia nao e erro: o resultado e ignorado.
  static func clear() {
    _ = SecItemDelete(baseQuery as CFDictionary)
  }
}
