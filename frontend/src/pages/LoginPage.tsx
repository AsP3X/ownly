// Human: Sign-in page for returning users after setup is complete — Ownly wireframe layout.
// Agent: CALLS login API; setAuth; navigate "/"; shows AccountNotActivatedDialog for inactive accounts.

import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Mail } from "lucide-react";
import { getErrorMessage, login, registrationSetting } from "@/api/client";
import { AccountNotActivatedDialog } from "@/components/auth/AccountNotActivatedDialog";
import { useAuth } from "@/hooks/useAuth";
import { isAccountActivationBlockedMessage } from "@/lib/account-activation";
import { getJwtExp } from "@/lib/jwt";
import { AuthFooterLink } from "@/components/auth/AuthFooterLink";
import { AuthFormCard } from "@/components/auth/AuthFormCard";
import { AuthIconField } from "@/components/auth/AuthIconField";
import { AuthPageShell } from "@/components/auth/AuthPageShell";
import { AuthPasswordField } from "@/components/auth/AuthPasswordField";
import { AuthSubmitButton } from "@/components/auth/AuthSubmitButton";
import { Alert, AlertDescription } from "@/components/ui/alert";

const REMEMBER_EMAIL_KEY = "ownly.auth.rememberEmail";

// Human: Read remembered email from localStorage, migrating legacy sessionStorage values once.
// Agent: READS localStorage; ONE-TIME COPY from sessionStorage when upgrading older clients.
function readRememberedEmail(): string {
  try {
    const fromLocal = localStorage.getItem(REMEMBER_EMAIL_KEY);
    if (fromLocal) return fromLocal;
    const legacy = sessionStorage.getItem(REMEMBER_EMAIL_KEY);
    if (legacy) {
      localStorage.setItem(REMEMBER_EMAIL_KEY, legacy);
      sessionStorage.removeItem(REMEMBER_EMAIL_KEY);
      return legacy;
    }
  } catch {
    // Private mode — fall back to empty prefill.
  }
  return "";
}

type LoginLocationState = {
  from?: string;
  email?: string;
  info?: string;
};

export default function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { setAuth, token } = useAuth();
  const locationState = location.state as LoginLocationState | null;
  const redirectTo =
    locationState?.from ??
    new URLSearchParams(location.search).get("next") ??
    "/";
  // Human: Registration redirect email wins over remembered email on first paint.
  // Agent: READS location.state.email from RegisterPage; falls back to localStorage remember key.
  const savedEmail = readRememberedEmail();
  const prefilledEmail = locationState?.email ?? savedEmail ?? "";
  const [email, setEmail] = useState(prefilledEmail);
  const [password, setPassword] = useState("");
  const [rememberMe, setRememberMe] = useState(Boolean(prefilledEmail));
  const [error, setError] = useState("");
  const [info, setInfo] = useState(
    locationState?.info && !isAccountActivationBlockedMessage(locationState.info)
      ? locationState.info
      : "",
  );
  const [activationDialogOpen, setActivationDialogOpen] = useState(
    Boolean(locationState?.info && isAccountActivationBlockedMessage(locationState.info)),
  );
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

  // Human: Drop one-time navigation state so refresh does not re-apply registration prefill or info.
  // Agent: replace history entry after reading email/info from RegisterPage redirect.
  useEffect(() => {
    if (!locationState?.email && !locationState?.info) return;
    navigate(`${location.pathname}${location.search}`, {
      replace: true,
      state: locationState.from ? { from: locationState.from } : null,
    });
  }, [location.pathname, location.search, locationState, navigate]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setInfo("");
    setLoading(true);
    try {
      const res = await login(email.trim(), password);
      if (rememberMe) {
        localStorage.setItem(REMEMBER_EMAIL_KEY, email.trim());
      } else {
        localStorage.removeItem(REMEMBER_EMAIL_KEY);
      }
      // Human: Prefer server expires_in_seconds (cookie session) over decoding JWT body.
      const sessionExpHint =
        typeof res.expires_in_seconds === "number" && res.expires_in_seconds > 0
          ? Math.floor(Date.now() / 1000) + res.expires_in_seconds
          : res.token
            ? getJwtExp(res.token)
            : null;
      setAuth(res.user, sessionExpHint);
      navigate(redirectTo, { replace: true });
    } catch (err) {
      const message = getErrorMessage(err);
      if (isAccountActivationBlockedMessage(message)) {
        setActivationDialogOpen(true);
        setError("");
      } else {
        setError(message);
      }
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

      <AccountNotActivatedDialog
        open={activationDialogOpen}
        onDismiss={() => setActivationDialogOpen(false)}
      />
    </AuthPageShell>
  );
}
