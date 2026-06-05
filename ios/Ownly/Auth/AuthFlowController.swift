//
//  AuthFlowController.swift
//  Ownly
//
//  Owns auth flow: current screen and forward/back navigation. Used by RootView to show Splash/Login/Register/Main.
//

import SwiftUI

// Human: Small state machine for which full-screen auth surface is visible; animations use `isGoingBack` to pick slide direction.
// Agent: AuthScreen enum splash|login|register|main; AuthFlowController @Observable screen; goForward/goBack withAnimation elasticSlide.

enum AuthScreen {
    case splash
    case login
    case register
    case main
}

@Observable
final class AuthFlowController {
    // Human: Cold start jumps straight to main when a Keychain token exists so returning users skip splash until validation fails.
    // Agent: init screen token? .main : .splash; goForward sets isGoingBack false; goBack async dispatch sets isGoingBack true.

    var screen: AuthScreen
    /// Used for WhatsApp/Telegram-style push (forward) vs pop (back) transitions.
    var isGoingBack: Bool = false

    private let pushPopAnimation = Animation.elasticSlide

    init(initialScreen: AuthScreen? = nil) {
        self.screen = initialScreen ?? (AuthTokenStorage.getToken() != nil ? .main : .splash)
    }

    func goForward(to newScreen: AuthScreen) {
        isGoingBack = false
        withAnimation(pushPopAnimation) { screen = newScreen }
    }

    func goBack(to newScreen: AuthScreen) {
        isGoingBack = true
        DispatchQueue.main.async {
            withAnimation(self.pushPopAnimation) { self.screen = newScreen }
        }
    }
}
