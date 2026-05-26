//
//  AuthTokenStorage.swift
//  MediaVault
//
//  Keychain-backed storage for the auth token. Isolated to this app via service identifier.
//

import Foundation
import Security

// Human: Bearer tokens never live in UserDefaults—Keychain keeps them out of backups and shared with minimal attack surface.
// Agent: kSecClassGenericPassword service com.mediavault.auth account loginToken; save getToken clear use SecItemAdd CopyMatching Delete.

enum AuthTokenStorage {
    private static let service = "com.mediavault.auth"
    private static let account = "loginToken"

    /// Saves the token to the Keychain. Overwrites any existing token.
    static func save(token: String) {
        guard let data = token.data(using: .utf8) else { return }
        deleteItem()
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecValueData as String: data,
        ]
        SecItemAdd(query as CFDictionary, nil)
    }

    /// Returns the stored token, or nil if none or on error.
    static func getToken() -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var result: AnyObject?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        guard status == errSecSuccess,
              let data = result as? Data,
              let token = String(data: data, encoding: .utf8) else {
            return nil
        }
        return token
    }

    /// Removes the stored token from the Keychain.
    static func clear() {
        deleteItem()
    }

    private static func deleteItem() {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
        SecItemDelete(query as CFDictionary)
    }
}
