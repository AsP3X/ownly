// Human: Self-service registration when the instance allows public sign-ups — Ownly signup wireframe.
// Agent: CALLS register API (email + password only); success dialog then /login with prefilled email; validates confirm password + terms.

import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Mail, User } from "lucide-react";
import { getErrorMessage, register } from "@/api/client";
import { AuthFooterLink } from "@/components/auth/AuthFooterLink";
import { RegisterSuccessDialog } from "@/components/auth/RegisterSuccessDialog";
import { AuthFormCard } from "@/components/auth/AuthFormCard";
import { AuthIconField } from "@/components/auth/AuthIconField";
import { AuthPageShell } from "@/components/auth/AuthPageShell";
import { AuthPasswordField } from "@/components/auth/AuthPasswordField";
import { AuthSubmitButton } from "@/components/auth/AuthSubmitButton";
import { Alert, AlertDescription } from "@/components/ui/alert";

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
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
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
    <AuthPageShell>
      <AuthFormCard
        title="Create your account"
        subtitle="Get started with your secure file storage."
        footer={<AuthFooterLink prefix="Already have an account?" linkLabel="Sign in" to="/login" />}
      >
        <form onSubmit={handleSubmit} className="flex flex-col gap-6">
          <div className="flex flex-col gap-4">
            <AuthIconField
              id="full-name"
              label="Full Name"
              icon={User}
              type="text"
              placeholder="John Doe"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              autoComplete="name"
              required
            />
            <AuthIconField
              id="email"
              label="Email Address"
              icon={Mail}
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              required
            />
            <AuthPasswordField
              id="password"
              label="Password"
              value={password}
              onChange={setPassword}
              autoComplete="new-password"
              required
            />
            <AuthPasswordField
              id="confirm-password"
              label="Confirm Password"
              value={confirmPassword}
              onChange={setConfirmPassword}
              autoComplete="new-password"
              required
              aria-invalid={confirmPassword.length > 0 && password !== confirmPassword}
            />
          </div>

          {/* Human: Terms row — checkbox + label from Pencil Terms Row */}
          <label className="flex cursor-pointer items-center gap-2 text-sm text-[#666666]">
            <input
              type="checkbox"
              checked={termsAccepted}
              onChange={(e) => setTermsAccepted(e.target.checked)}
              className="size-4 shrink-0 rounded border border-[#E5E7EB] accent-[#2563EB]"
            />
            <span>
              I agree to the{" "}
              <span className="font-semibold text-[#2563EB]">Terms of Service</span>
            </span>
          </label>

          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          <AuthSubmitButton loading={loading} loadingLabel="Creating account…">
            Create Account
          </AuthSubmitButton>
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
