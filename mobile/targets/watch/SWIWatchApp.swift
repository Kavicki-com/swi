import SwiftUI

@main
struct SWIWatchApp: App {
  @StateObject private var collector = WorkoutCollector()

  var body: some Scene {
    WindowGroup {
      ContentView()
        .environmentObject(collector)
    }
  }
}
