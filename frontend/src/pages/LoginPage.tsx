// Human: Sign-in page for returning users after setup is complete — Ownly wireframe layout.
// Agent: CALLS login API; setAuth; navigate "/"; READS registration setting for optional sign-up link.

import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Mail } from "lucide-react";
import { getErrorMessage, login, registrationSetting } from "@/api/client";
import { useAuth } from "@/hooks/useAuth";
import { AuthFooterLink } from "@/components/auth/AuthFooterLink";
import { AuthFormCard } from "@/components/auth/AuthFormCard";
import { AuthIconField } from "@/components/auth/AuthIconField";
import { AuthPageShell } from "@/components/auth/AuthPageShell";
import { AuthPasswordField } from "@/components/auth/AuthPasswordField";
import { AuthSubmitButton } from "@/components/auth/AuthSubmitButton";
import { Alert, AlertDescription } from "@/components/ui/alert";

const REMEMBER_EMAIL_KEY = "ownly.auth.rememberEmail";

export default function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { setAuth, token } = useAuth();
  const redirectTo =
    (location.state as { from?: string } | null)?.from ??
    new URLSearchParams(location.search).get("next") ??
    "/";
  // Human: Restore remembered email on first paint without a hydration effect.
  const savedEmail = sessionStorage.getItem(REMEMBER_EMAIL_KEY);
  const [email, setEmail] = useState(savedEmail ?? "");
  const [password, setPassword] = useState("");
  const [rememberMe, setRememberMe] = useState(Boolean(savedEmail));
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [loading, setLoading] = useState(false);
  const [allowRegister, setAllowRegister] = useState(false);

  useEffect(() => {
    if (token) navigate(redirectTo, { replace: true });
  }, [token, navigate, redirectTo]);

  useEffect(() => {
    registrationSetting()
      .then((res) => setAllowRegister(res.allow_public_registration))
      .catch(() => undefined);
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setInfo("");
    setLoading(true);
    try {
      const res = await login(email.trim(), password);
      if (!res.token) {
        setError("Login did not return a session token.");
        return;
      }
      if (rememberMe) {
        sessionStorage.setItem(REMEMBER_EMAIL_KEY, email.trim());
      } else {
        sessionStorage.removeItem(REMEMBER_EMAIL_KEY);
      }
      setAuth(res.token, res.user);
      navigate(redirectTo, { replace: true });
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthPageShell>
      <AuthFormCard
        title="Welcome back"
        subtitle="Enter your details to access your secure files"
        footer={
          allowRegister ? (
            <AuthFooterLink prefix="Don't have an account?" linkLabel="Sign up" to="/register" />
          ) : undefined
        }
      >
        <form onSubmit={handleSubmit} className="flex flex-col gap-6">
          <div className="flex flex-col gap-4">
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
              autoComplete="current-password"
              required
            />
          </div>

          {/* Human: Remember + forgot row from Pencil Remember Forgot Row */}
          <div className="flex items-center justify-between gap-4">
            <label className="flex cursor-pointer items-center gap-2 text-sm text-[#666666]">
              <input
                type="checkbox"
                checked={rememberMe}
                onChange={(e) => setRememberMe(e.target.checked)}
                className="size-4 rounded border border-[#E5E7EB] accent-[#2563EB]"
              />
              Remember me
            </label>
            <button
              type="button"
              className="text-sm font-semibold text-[#2563EB] hover:underline"
              onClick={() => {
                setInfo("");
                setError("");
                setInfo("Contact your administrator to reset your password.");
              }}
            >
              Forgot password?
            </button>
          </div>

          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          {info ? (
            <Alert>
              <AlertDescription>{info}</AlertDescription>
            </Alert>
          ) : null}

          <AuthSubmitButton loading={loading} loadingLabel="Signing in…">
            Sign In
          </AuthSubmitButton>
        </form>
      </AuthFormCard>
    </AuthPageShell>
  );
}
