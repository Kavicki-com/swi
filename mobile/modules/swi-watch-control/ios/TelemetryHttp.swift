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

  /// Uma sessao so, criada uma vez. URLSession criada por chamada e nunca
  /// invalidada vaza (a sessao retem seu delegate e sua fila ate
  /// `invalidateAndCancel`), e uma sessao compartilhada reaproveita a conexao
  /// entre envios consecutivos, que e o caso da telemetria.
  ///
  /// 20 s e o mesmo prazo do cliente HTTP do app em `services/api/http.ts`,
  /// pelo mesmo motivo escrito la: folgado para 3G ruim e curto o bastante
  /// para virar erro acionavel em vez de carregamento eterno.
  private static let session: URLSession = {
    let configuration = URLSessionConfiguration.default
    configuration.timeoutIntervalForRequest = 20
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
    let rawBody: String
    if let data = data, let decoded = String(data: data, encoding: .utf8) {
      rawBody = decoded
    } else {
      rawBody = ""
    }

    guard storeCredential, status >= 200, status <= 299, let data = data else {
      return .success(Response(status: status, body: rawBody))
    }

    // Corpo que nao e um objeto JSON, ou objeto sem `credential` em texto,
    // volta intacto: nao ha o que guardar e o JavaScript le o que veio.
    guard
      let object = try? JSONSerialization.jsonObject(with: data, options: []),
      let parsed = object as? [String: Any],
      let credential = parsed["credential"] as? String
    else {
      return .success(Response(status: status, body: rawBody))
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
