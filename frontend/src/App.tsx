// Human: Application shell — setup gate, auth routes, and the main drive experience.
// Agent: WRAPS BrowserRouter+AuthProvider; SetupGuard reads setupStatus; lazy-loads route chunks via Suspense.

import { lazy, Suspense, useEffect, useState } from "react";
import { BrowserRouter, Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import NotFoundPage from "@/pages/NotFoundPage";
import { setupStatus } from "@/api/client";
import { RouteLoadingFallback } from "@/components/RouteLoadingFallback";
import { AuthProvider } from "@/context/AuthContext";
import { InstanceNameProvider } from "@/context/InstanceNameContext";
import { Toaster } from "@/components/ui/sonner";
import { useAuth } from "@/hooks/useAuth";
import SetupPage from "@/pages/SetupPage";
import LoginPage from "@/pages/LoginPage";
import RegisterPage from "@/pages/RegisterPage";

// Human: Route-level code splitting — heavy pages load only when navigated to.
// Agent: dynamic import() per page; Suspense fallback is RouteLoadingFallback.
const LandingPage = lazy(() => import("@/pages/LandingPage"));
const FeaturesPage = lazy(() => import("@/pages/FeaturesPage"));
const SecurityPage = lazy(() => import("@/pages/SecurityPage"));
const PricingPage = lazy(() => import("@/pages/PricingPage"));
const FaqPage = lazy(() => import("@/pages/FaqPage"));
const NebularOsSpecsPage = lazy(() => import("@/pages/NebularOsSpecsPage"));
const StorageSpecsPage = lazy(() => import("@/pages/StorageSpecsPage"));
const DrivePage = lazy(() => import("@/pages/DrivePage"));
const AdminDashboardWireframePage = lazy(() => import("@/pages/AdminDashboardWireframePage"));
const PublicSharePage = lazy(() => import("@/pages/PublicSharePage"));

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
  const location = useLocation();
  // Human: Guests keep the intended URL via `next` so login + reload return to the same page.
  // Agent: NAVIGATE /login?next=<encoded path+search>; READS location from react-router.
  if (!token) {
    const next = encodeURIComponent(`${location.pathname}${location.search}`);
    return <Navigate to={`/login?next=${next}`} replace />;
  }
  return <>{children}</>;
}

// Human: Default home — landing page for all guests after setup; drive when authenticated.
// Agent: READS token from AuthContext; lazy-loads LandingPage or DrivePage on demand.
function HomeRoute() {
  const { token } = useAuth();
  return (
    <Suspense fallback={<RouteLoadingFallback />}>
      {token ? <DrivePage /> : <LandingPage />}
    </Suspense>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <InstanceNameProvider>
        <SetupGuard>
          <Suspense fallback={<RouteLoadingFallback />}>
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
              <Route path="*" element={<NotFoundPage />} />
            </Routes>
          </Suspense>
        </SetupGuard>
        <Toaster richColors closeButton position="top-center" />
        </InstanceNameProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}
