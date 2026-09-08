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

  /// Erro proprio para o unico caso que nao vem da URLSession: resposta sem
  /// HTTPURLResponse.
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

  /// URL(string:) aceita "localhost:3000" (esquema "localhost", sem host) e
  /// isso so falharia la na frente como E_NETWORK. Exigir http ou https com
  /// host faz URL errada ser E_URL, que e o que ela e.
  static func parseUrl(_ raw: String) -> URL? {
    guard let url = URL(string: raw) else {
      return nil
    }
    let scheme = url.scheme ?? ""
    guard scheme == "http" || scheme == "https" else {
      return nil
    }
    guard let host = url.host, !host.isEmpty else {
      return nil
    }
    return url
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
    // Sem cookies: um Set-Cookie do backend ou do balanceador iria junto com
    // o Authorization na chamada seguinte, e o primitivo e burro de verdade.
    configuration.httpCookieStorage = nil
    configuration.httpShouldSetCookies = false
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
    // URLRequest nasce com 60 s proprios, e a documentacao e ambigua sobre
    // qual prazo vence entre o da requisicao e o da configuracao. Os dois em
    // 20 tiram a duvida.
    urlRequest.timeoutInterval = 20
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
      // A gravacao e o fato; a reescrita e cosmetica. O chaveiro ja tem a
      // credencial, entao falhar aqui faria o JavaScript concluir que nao
      // pareou enquanto pareou. Sobe o minimo que ele precisa saber.
      return .success(Response(status: status, body: "{\"credential\":true}"))
    }
    return .success(Response(status: status, body: rewrittenBody))
  }
}
