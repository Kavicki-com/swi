import Foundation

/// Primitivo HTTP do envio de telemetria. Burro de proposito.
///
/// Recebe URL, metodo, corpo em texto e o cabecalho de autorizacao ja montado;
/// devolve status e corpo crus. Status HTTP de erro e resposta, nao excecao:
/// so falha de rede, tempo esgotado ou resposta que nao e HTTP viram
/// `.failure`. Quem decide o que fazer com um 401 ou um 500 e o JavaScript,
/// onde o teste e gratis.
///
/// Este e o unico lugar do modulo que interpreta JSON, e e de uma chave so:
/// `credential`, na resposta do pareamento, que vai para o chaveiro e volta
/// ao JavaScript trocada por `true`. Tudo o mais fica cru.
enum TelemetryHttp {
  struct Response {
    let status: Int
    let body: String
  }

  /// Erro proprio para os dois casos que nao vem da URLSession: resposta sem
  /// HTTPURLResponse e corpo que nao pode ser reescrito depois de guardar a
  /// credencial.
  struct TelemetryHttpError: LocalizedError {
    let message: String

    var errorDescription: String? {
      return message
    }
  }

  /// Resposta 2xx do pareamento sem `credential` em texto na raiz do objeto.
  /// Tipo proprio, e nao uma mensagem, para o modulo mapear num codigo que o
  /// JavaScript distingue de falha de rede.
  struct CredentialMissingError: LocalizedError {
    var errorDescription: String? {
      return "Resposta do pareamento sem credencial"
    }
  }

  /// Codigo de rejeicao que o modulo entrega ao JavaScript para cada falha.
  /// Fica aqui, e nao no closure do modulo, para o closure dentro do result
  /// builder continuar curto: e o maior risco de tempo de type-check.
  static func rejectionCode(for error: Error) -> String {
    if error is DeviceCredentialStore.KeychainError {
      return "E_KEYCHAIN"
    }
    if error is CredentialMissingError {
      return "E_CREDENTIAL_MISSING"
    }
    return "E_NETWORK"
  }

  /// Uma sessao so, criada uma vez. URLSession criada por chamada e nunca
  /// invalidada vaza (a sessao retem seu delegate e sua fila ate
  /// `invalidateAndCancel`), e uma sessao compartilhada reaproveita a conexao
  /// entre envios consecutivos, que e o caso da telemetria.
  ///
  /// 20 s e o mesmo prazo do cliente HTTP do app em `services/api/http.ts`,
  /// pelo mesmo motivo escrito la: folgado para 3G ruim e curto o bastante
  /// para virar erro acionavel em vez de carregamento eterno. Os dois prazos
  /// juntos dao paridade com o withDeadline de la, que cobre a operacao
  /// inteira: `ForRequest` reinicia a cada byte recebido e so pega silencio;
  /// `ForResource` e o teto total, do primeiro byte enviado ao ultimo lido.
  private static let session: URLSession = {
    let configuration = URLSessionConfiguration.default
    configuration.timeoutIntervalForRequest = 20
    configuration.timeoutIntervalForResource = 20
    return URLSession(configuration: configuration)
  }()

  static func request(
    url: URL,
    method: String,
    body: String?,
    authorization: String?,
    storeCredentialFromResponse: Bool,
    completion: @escaping (Result<Response, Error>) -> Void
  ) {
    var urlRequest = URLRequest(url: url)
    urlRequest.httpMethod = method
    if let body = body {
      urlRequest.httpBody = Data(body.utf8)
      urlRequest.setValue("application/json", forHTTPHeaderField: "Content-Type")
    }
    if let authorization = authorization {
      urlRequest.setValue(authorization, forHTTPHeaderField: "Authorization")
    }

    let task = TelemetryHttp.session.dataTask(with: urlRequest) { data, response, error in
      let result = TelemetryHttp.handle(
        data: data,
        response: response,
        error: error,
        storeCredential: storeCredentialFromResponse
      )
      // O resolve e o reject do Expo Modules sao seguros de qualquer thread
      // (passam pelo CallInvoker do React Native). A fila principal aqui e
      // convencao do modulo, nao exigencia: todo callback do receptor da
      // sessao espelhada tambem chega nela.
      DispatchQueue.main.async {
        completion(result)
      }
    }
    task.resume()
  }

  private static func handle(
    data: Data?,
    response: URLResponse?,
    error: Error?,
    storeCredential: Bool
  ) -> Result<Response, Error> {
    if let error = error {
      return .failure(error)
    }
    guard let httpResponse = response as? HTTPURLResponse else {
      return .failure(TelemetryHttpError(message: "Resposta sem status HTTP"))
    }

    let status = httpResponse.statusCode
    let payloadData: Data = data ?? Data()
    let rawBody: String = String(data: payloadData, encoding: .utf8) ?? ""

    if !storeCredential || status < 200 || status > 299 {
      return .success(Response(status: status, body: rawBody))
    }

    // Daqui para baixo o corpo e a resposta de um pareamento bem-sucedido e
    // NUNCA sobe intacto. Se nao for um objeto JSON com `credential` em texto
    // na raiz (o backend embrulhou a resposta, ou mudou a chave), a falha e
    // ruidosa: e melhor o pareamento falhar ruidosamente do que a credencial
    // vazar em silencio para o JavaScript.
    guard
      let object = try? JSONSerialization.jsonObject(with: payloadData, options: []),
      let parsed = object as? [String: Any],
      let credential = parsed["credential"] as? String
    else {
      return .failure(CredentialMissingError())
    }

    // Guardar falhou: o JavaScript nao pode acreditar que pareou. O corpo
    // original nao volta em nenhum caminho de erro, porque contem a credencial.
    do {
      try DeviceCredentialStore.write(credential)
    } catch {
      return .failure(error)
    }

    var rewritten = parsed
    rewritten["credential"] = true
    guard
      let rewrittenData = try? JSONSerialization.data(withJSONObject: rewritten, options: []),
      let rewrittenBody = String(data: rewrittenData, encoding: .utf8)
    else {
      return .failure(TelemetryHttpError(message: "Credencial guardada, mas a resposta nao pode ser reescrita"))
    }
    return .success(Response(status: status, body: rewrittenBody))
  }
}
