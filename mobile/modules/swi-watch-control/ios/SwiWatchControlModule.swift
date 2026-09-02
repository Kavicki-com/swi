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
