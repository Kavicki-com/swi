import ExpoModulesCore

/// Registra o handler de sessao espelhada no launch. Sem isso o sistema nao
/// consegue entregar a HKWorkoutSession do relogio quando acorda o app.
public class SwiWatchControlAppDelegateSubscriber: ExpoAppDelegateSubscriber {
  public func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    if #available(iOS 17.0, *) {
      MirroredWorkoutReceiver.shared.install()
    }
    return true
  }
}
