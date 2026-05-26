import Foundation

// Human: Lightweight profile hints persisted after login for the drive shell header.
// Agent: READS/WRITES UserDefaults; CLEAR on logout from RootView.
enum UserProfileStorage {
    private enum Keys {
        static let email = "mediavault.profile.email"
    }

    static var email: String? {
        get { UserDefaults.standard.string(forKey: Keys.email) }
        set {
            if let newValue {
                UserDefaults.standard.set(newValue, forKey: Keys.email)
            } else {
                UserDefaults.standard.removeObject(forKey: Keys.email)
            }
        }
    }

    static func clear() {
        email = nil
    }
}
