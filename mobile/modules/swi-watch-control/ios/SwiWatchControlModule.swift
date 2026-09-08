import ExpoModulesCore

public class SwiWatchControlModule: Module {
  public func definition() -> ModuleDefinition {
    Name("SwiWatchControl")

    Events("onMirroredSessionChanged", "onHeartRateSample")

    Function("getStatus") { () -> [String: Any] in
      if #available(iOS 17.0, *) {
        return MirroredWorkoutReceiver.shared.statusPayload
      }
      return WatchControlStatusPayload.unavailable
    }

    AsyncFunction("requestAuthorization") { (promise: Promise) in
      if #available(iOS 17.0, *) {
        MirroredWorkoutReceiver.shared.requestAuthorization { granted in
          promise.resolve(granted)
        }
      } else {
        promise.resolve(false)
      }
    }

    AsyncFunction("startMonitoring") { (promise: Promise) in
      if #available(iOS 17.0, *) {
        MirroredWorkoutReceiver.shared.startMonitoring { started in
          promise.resolve(started)
        }
      } else {
        promise.resolve(false)
      }
    }

    // Envio de telemetria. Nada daqui para baixo depende de HealthKit, por
    // isso nao ha #available: o primitivo HTTP e o chaveiro existem em
    // qualquer iOS que o app suporte.

    // A tela pergunta se ha credencial para mostrar "pareado". O valor em si
    // nunca sobe: so o fato de existir.
    Function("hasDeviceCredential") { () -> Bool in
      return DeviceCredentialStore.read() != nil
    }

    // Revogacao e do painel; o iPhone descobre pelo 401 no envio e limpa aqui.
    Function("clearDeviceCredential") { () -> Void in
      DeviceCredentialStore.clear()
    }

    // Primitivo HTTP. Dois modos de autenticacao: `device` monta o cabecalho
    // com a credencial do chaveiro, sem que ela passe pelo JavaScript;
    // `bearer` usa o token que o JavaScript ja tem por desenho. Qualquer
    // outro `kind` vai sem cabecalho. Resolve status e corpo crus; rejeita
    // por URL invalida, aparelho nao pareado, falha de rede, chaveiro que
    // recusou guardar, ou resposta de pareamento sem credencial.
    AsyncFunction("request") { (url: String, method: String, body: String?, auth: [String: Any], storeCredential: Bool, promise: Promise) in
      guard let parsedUrl = TelemetryHttp.parseUrl(url) else {
        promise.reject("E_URL", "URL invalida")
        return
      }

      var authorization: String? = nil
      let kind: String? = auth["kind"] as? String
      if kind == "device" {
        // Sem credencial, rejeita antes de tocar a rede: o JavaScript trata
        // como "nao pareado", nao como falha de envio.
        guard let credential = DeviceCredentialStore.read() else {
          promise.reject("E_NO_CREDENTIAL", "Aparelho nao pareado")
          return
        }
        authorization = "Device " + credential
      } else if kind == "bearer", let token = auth["token"] as? String {
        authorization = "Bearer " + token
      }

      TelemetryHttp.request(
        url: parsedUrl,
        method: method,
        body: body,
        authorization: authorization,
        storeCredentialFromResponse: storeCredential
      ) { result in
        switch result {
        case .success(let response):
          let payload: [String: Any] = ["status": response.status, "body": response.body]
          promise.resolve(payload)
        case .failure(let error):
          promise.reject(TelemetryHttp.rejectionCode(for: error), error.localizedDescription)
        }
      }
    }

    OnStartObserving {
      if #available(iOS 17.0, *) {
        let receiver = MirroredWorkoutReceiver.shared
        receiver.onSessionChanged = { [weak self] state, changedAt in
          self?.sendEvent("onMirroredSessionChanged", [
            "state": state.rawValue,
            "changedAt": changedAt,
          ])
        }
        receiver.onSample = { [weak self] sample in
          self?.sendEvent("onHeartRateSample", [
            "bpm": sample.bpm,
            "measuredAt": sample.measuredAt,
          ])
        }
      }
    }

    OnStopObserving {
      if #available(iOS 17.0, *) {
        MirroredWorkoutReceiver.shared.onSessionChanged = nil
        MirroredWorkoutReceiver.shared.onSample = nil
      }
    }
  }
}
