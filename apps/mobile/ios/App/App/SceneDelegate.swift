import UIKit
import Capacitor

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?
    private let finishTime = FinishRecordingTime()

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }

        window = UIWindow(windowScene: windowScene)
        window?.rootViewController = CAPBridgeViewController()
        window?.makeKeyAndVisible()

        SceneDelegateProxy.shared.scene(scene, willConnectTo: session, options: connectionOptions)
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        SceneDelegateProxy.shared.scene(scene, openURLContexts: URLContexts)
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        SceneDelegateProxy.shared.scene(scene, continue: userActivity)
    }

    // The phone locked or the app left the screen. Field Capture (the web app,
    // via js/native-bridge.js) finishes a day that is being filmed: it stops
    // the recorder and saves the film on the phone so it files when the app
    // is back. Ask iOS for its short background time so that save can finish
    // before the app is suspended. No background audio/recording mode.
    func sceneDidEnterBackground(_ scene: UIScene) {
        finishTime.begin()
    }

    func sceneWillEnterForeground(_ scene: UIScene) {
        finishTime.end()
    }
}

/// One `beginBackgroundTask` while the app is off screen; iOS ends it after
/// its usual ~30 seconds, or we end it when the app comes back.
final class FinishRecordingTime {
    private var task: UIBackgroundTaskIdentifier = .invalid

    func begin() {
        guard task == .invalid else { return }
        task = UIApplication.shared.beginBackgroundTask(withName: "FieldCaptureFinishDay") { [weak self] in
            self?.end()
        }
    }

    func end() {
        guard task != .invalid else { return }
        UIApplication.shared.endBackgroundTask(task)
        task = .invalid
    }
}
