// Human: Application shell — setup gate, auth routes, and the main drive experience.
// Agent: WRAPS BrowserRouter+AuthProvider; SetupGuard reads setupStatus; redirects /setup until complete.

import { useEffect, useState } from "react";
import { BrowserRouter, Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { setupStatus } from "@/api/client";
import { AuthProvider } from "@/context/AuthContext";
import { useAuth } from "@/hooks/useAuth";
import SetupPage from "@/pages/SetupPage";
import LoginPage from "@/pages/LoginPage";
import LandingPage from "@/pages/LandingPage";
import FeaturesPage from "@/pages/FeaturesPage";
import SecurityPage from "@/pages/SecurityPage";
import PricingPage from "@/pages/PricingPage";
import FaqPage from "@/pages/FaqPage";
import NebularOsSpecsPage from "@/pages/NebularOsSpecsPage";
import StorageSpecsPage from "@/pages/StorageSpecsPage";
import DrivePage from "@/pages/DrivePage";
import AdminDashboardWireframePage from "@/pages/AdminDashboardWireframePage";
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
      // Human: Post-setup default is `/` — landing for guests, drive when setup returned a session token.
      navigate("/", { replace: true });
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
  // Human: Guests hitting protected URLs land on the public landing page, not login.
  if (!token) return <Navigate to="/" replace />;
  return <>{children}</>;
}

// Human: Default home — landing page for all guests after setup; drive when authenticated.
// Agent: READS token from AuthContext; `/` is the guest entry point (logout and unknown routes also resolve here).
function HomeRoute() {
  const { token } = useAuth();
  if (token) return <DrivePage />;
  return <LandingPage />;
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
            <Route path="/features" element={<FeaturesPage />} />
            <Route path="/security" element={<SecurityPage />} />
            <Route path="/pricing" element={<PricingPage />} />
            <Route path="/faq" element={<FaqPage />} />
            <Route path="/specs/nebular-os" element={<NebularOsSpecsPage />} />
            <Route path="/specs/storage" element={<StorageSpecsPage />} />
            <Route path="/s/:token" element={<PublicSharePage />} />
            <Route path="/" element={<HomeRoute />} />
            <Route
              path="/admin"
              element={
                <ProtectedRoute>
                  <AdminDashboardWireframePage />
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
