import Foundation
import Observation

// Human: Tracks whether the first-use onboarding flow has been completed.
// Agent: READS/WRITES UserDefaults flags; DRIVES onboarding vs drive routing.
@Observable
final class OnboardingStore {
    static let shared = OnboardingStore()

    private enum Keys {
        static let complete = "onboardingComplete"
        static let permissionsPrompted = "permissionsPrompted"
        static let tourComplete = "onboardingTourComplete"
    }

    private(set) var isComplete: Bool
    private(set) var permissionsPrompted: Bool
    private(set) var tourComplete: Bool

    private init() {
        let defaults = UserDefaults.standard
        isComplete = defaults.bool(forKey: Keys.complete)
        permissionsPrompted = defaults.bool(forKey: Keys.permissionsPrompted)
        tourComplete = defaults.bool(forKey: Keys.tourComplete)
    }

    func markPermissionsPrompted() {
        permissionsPrompted = true
        UserDefaults.standard.set(true, forKey: Keys.permissionsPrompted)
    }

    func markTourComplete() {
        tourComplete = true
        UserDefaults.standard.set(true, forKey: Keys.tourComplete)
    }

    func markComplete() {
        isComplete = true
        UserDefaults.standard.set(true, forKey: Keys.complete)
    }

    /// Clears onboarding flags for debugging or sign-out flows that should replay onboarding.
    func reset() {
        let defaults = UserDefaults.standard
        defaults.removeObject(forKey: Keys.complete)
        defaults.removeObject(forKey: Keys.permissionsPrompted)
        defaults.removeObject(forKey: Keys.tourComplete)
        isComplete = false
        permissionsPrompted = false
        tourComplete = false
    }
}
