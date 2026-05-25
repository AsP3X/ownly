// Human: Application shell — setup gate, auth routes, and the main drive experience.
// Agent: WRAPS BrowserRouter+AuthProvider; SetupGuard reads setupStatus; redirects /setup until complete.

import { useEffect, useState } from "react";
import { BrowserRouter, Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { setupStatus } from "@/api/client";
import { AuthProvider } from "@/context/AuthContext";
import { useAuth } from "@/hooks/useAuth";
import SetupPage from "@/pages/SetupPage";
import LoginPage from "@/pages/LoginPage";
import DrivePage from "@/pages/DrivePage";
import RegisterPage from "@/pages/RegisterPage";
import PublicSharePage from "@/pages/PublicSharePage";

function SetupGuard({ children }: { children: React.ReactNode }) {
  const [setupComplete, setSetupComplete] = useState<boolean | null>(null);
  const { token, logout } = useAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();

  useEffect(() => {
    let cancelled = false;
    setupStatus()
      .then((s) => {
        if (!cancelled) setSetupComplete(s.setup_complete);
      })
      .catch(() => {
        if (!cancelled) setSetupComplete(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  useEffect(() => {
    if (setupComplete === false && token) logout();
  }, [setupComplete, token, logout]);

  useEffect(() => {
    if (setupComplete === null) return;
    if (setupComplete && pathname === "/setup") {
      navigate(token ? "/" : "/login", { replace: true });
      return;
    }
    if (!setupComplete && pathname !== "/setup" && !pathname.startsWith("/s/")) {
      navigate("/setup", { replace: true });
    }
  }, [setupComplete, pathname, token, navigate]);

  if (setupComplete === null) {
    return (
      <div className="min-h-screen flex items-center justify-center text-muted-foreground">
        Loading…
      </div>
    );
  }

  return <>{children}</>;
}

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { token } = useAuth();
  if (!token) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <SetupGuard>
          <Routes>
            <Route path="/setup" element={<SetupPage />} />
            <Route path="/login" element={<LoginPage />} />
            <Route path="/register" element={<RegisterPage />} />
            <Route path="/s/:token" element={<PublicSharePage />} />
            <Route
              path="/"
              element={
                <ProtectedRoute>
                  <DrivePage />
                </ProtectedRoute>
              }
            />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </SetupGuard>
      </AuthProvider>
    </BrowserRouter>
  );
}
