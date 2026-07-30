// Human: Self-service registration when the instance allows public sign-ups — Ownly signup wireframe.
// Agent: CALLS register API (email + password only); success dialog then /login with prefilled email; validates confirm password + terms.

import { useState, type CSSProperties } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Mail, User } from "lucide-react";
import { getErrorMessage, register } from "@/api/client";
import { AuthAlert } from "@/components/auth/AuthAlert";
import { AuthCheckbox } from "@/components/auth/AuthCheckbox";
import { AuthFooterLink } from "@/components/auth/AuthFooterLink";
import { RegisterSuccessDialog } from "@/components/auth/RegisterSuccessDialog";
import { AuthFormCard } from "@/components/auth/AuthFormCard";
import { AuthIconField } from "@/components/auth/AuthIconField";
import { AuthPageShell } from "@/components/auth/AuthPageShell";
import { AuthPasswordField } from "@/components/auth/AuthPasswordField";
import { AuthPasswordStrength } from "@/components/auth/AuthPasswordStrength";
import { AuthSubmitButton } from "@/components/auth/AuthSubmitButton";
import { PASSWORD_MIN_LENGTH } from "@/lib/password-strength";

export default function RegisterPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const redirectTo =
    (location.state as { from?: string } | null)?.from ??
    new URLSearchParams(location.search).get("next") ??
    "/";
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [successState, setSuccessState] = useState<{
    email: string;
    pendingActivation: boolean;
  } | null>(null);

  // Human: Live confirm-password feedback — only once the user has typed something to compare.
  const confirmTouched = confirmPassword.length > 0;
  const passwordsMatch = confirmTouched && password === confirmPassword;
  const confirmError =
    confirmTouched && !passwordsMatch ? "Passwords do not match." : null;

  // Human: After the success dialog, send the user to login with their email ready to fill in.
  // Agent: NAVIGATE /login with state.email + optional pending-activation info.
  function continueToLogin() {
    if (!successState) return;

    navigate("/login", {
      replace: true,
      state: {
        email: successState.email,
        from: redirectTo,
        info: successState.pendingActivation
          ? "An administrator must approve your account before you can sign in."
          : undefined,
      },
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (!fullName.trim()) {
      setError("Please enter your full name.");
      return;
    }
    if (password.length < PASSWORD_MIN_LENGTH) {
      setError(`Password must be at least ${PASSWORD_MIN_LENGTH} characters.`);
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }
    if (!termsAccepted) {
      setError("You must agree to the Terms of Service.");
      return;
    }

    setLoading(true);
    try {
      // Agent: register HTTP body is email + password only; fullName is UI-only until the API supports it.
      const trimmedEmail = email.trim();
      const res = await register(trimmedEmail, password);

      setSuccessState({
        email: trimmedEmail,
        pendingActivation: Boolean(res.pending_activation),
      });
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthPageShell mode="register">
      <AuthFormCard
        title="Create your account"
        subtitle="A few details and your storage is ready to use."
        footer={<AuthFooterLink prefix="Already have an account?" linkLabel="Sign in" to="/login" />}
      >
        <form onSubmit={handleSubmit} className="flex flex-col gap-6">
          {/* Human: Rows carry a stagger index so the card assembles top-down on entry. */}
          <div className="flex flex-col gap-4">
            <div className="auth-enter" style={{ "--auth-i": 2 } as CSSProperties}>
              <AuthIconField
                id="full-name"
                label="Full Name"
                icon={User}
                type="text"
                placeholder="John Doe"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                autoComplete="name"
                autoFocus
                required
              />
            </div>
            <div className="auth-enter" style={{ "--auth-i": 3 } as CSSProperties}>
              <AuthIconField
                id="email"
                label="Email Address"
                icon={Mail}
                type="email"
                inputMode="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                required
              />
            </div>
            <div className="auth-enter" style={{ "--auth-i": 4 } as CSSProperties}>
              <AuthPasswordField
                id="password"
                label="Password"
                placeholder="••••••••"
                value={password}
                onChange={setPassword}
                autoComplete="new-password"
                required
                below={<AuthPasswordStrength password={password} />}
              />
            </div>
            <div className="auth-enter" style={{ "--auth-i": 5 } as CSSProperties}>
              <AuthPasswordField
                id="confirm-password"
                label="Confirm Password"
                placeholder="••••••••"
                value={confirmPassword}
                onChange={setConfirmPassword}
                autoComplete="new-password"
                required
                error={confirmError}
                success={passwordsMatch ? "Passwords match." : null}
              />
            </div>
          </div>

          {/* Human: Terms row */}
          <div className="auth-enter" style={{ "--auth-i": 6 } as CSSProperties}>
            <AuthCheckbox checked={termsAccepted} onChange={setTermsAccepted}>
              I agree to the <span className="font-semibold text-brand">Terms of Service</span>
            </AuthCheckbox>
          </div>

          {error ? <AuthAlert key={error}>{error}</AuthAlert> : null}

          <div className="auth-enter" style={{ "--auth-i": 7 } as CSSProperties}>
            <AuthSubmitButton loading={loading} loadingLabel="Creating account…">
              Create Account
            </AuthSubmitButton>
          </div>
        </form>
      </AuthFormCard>

      <RegisterSuccessDialog
        open={successState !== null}
        pendingActivation={successState?.pendingActivation ?? false}
        onContinue={continueToLogin}
      />
    </AuthPageShell>
  );
}
