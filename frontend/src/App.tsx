// Human: Application shell — setup gate, auth routes, and the main drive experience.
// Agent: WRAPS BrowserRouter+AuthProvider; SetupGuard reads setupStatus; lazy-loads route chunks via Suspense.

import { lazy, Suspense, useEffect, useState } from "react";
import { BrowserRouter, Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { Toaster } from "sonner";
import { setupStatus } from "@/api/client";
import { OfflineBanner } from "@/components/OfflineBanner";
import { RouteErrorBoundary } from "@/components/RouteErrorBoundary";
import { RouteLoadingFallback } from "@/components/RouteLoadingFallback";
import { AuthProvider } from "@/context/AuthContext";
import { InstanceNameProvider } from "@/context/InstanceNameContext";
import { ThemeProvider } from "@/context/ThemeContext";
import { useAuth } from "@/hooks/useAuth";
import { useTheme } from "@/hooks/useTheme";
import { StorageMigrationUi } from "@/components/drive/StorageMigrationUi";
import { TransferPanelStack } from "@/components/drive/TransferPanelStack";
import { prefetchDrivePageChunk } from "@/lib/prefetch-route-chunks";
import { readSetupStatusCache, writeSetupStatusCache } from "@/lib/setup-status-cache";

// Human: Route-level code splitting — heavy pages load only when navigated to.
// Agent: dynamic import() per page; Suspense fallback is RouteLoadingFallback.
const LandingPage = lazy(() => import("@/pages/LandingPage"));
const FeaturesPage = lazy(() => import("@/pages/FeaturesPage"));
const SecurityPage = lazy(() => import("@/pages/SecurityPage"));
const PricingPage = lazy(() => import("@/pages/PricingPage"));
const FaqPage = lazy(() => import("@/pages/FaqPage"));
const PrivacyPolicyPage = lazy(() => import("@/pages/PrivacyPolicyPage"));
const NebularOsSpecsPage = lazy(() => import("@/pages/NebularOsSpecsPage"));
const StorageSpecsPage = lazy(() => import("@/pages/StorageSpecsPage"));
const DrivePage = lazy(() => import("@/pages/DrivePage"));
const AdminDashboardWireframePage = lazy(() => import("@/pages/AdminDashboardWireframePage"));
const ProfilePage = lazy(() => import("@/pages/ProfilePage"));
const SettingsPage = lazy(() => import("@/pages/SettingsPage"));
const PublicSharePage = lazy(() => import("@/pages/PublicSharePage"));
const SetupPage = lazy(() => import("@/pages/SetupPage"));
const LoginPage = lazy(() => import("@/pages/LoginPage"));
const RegisterPage = lazy(() => import("@/pages/RegisterPage"));
const NotFoundPage = lazy(() => import("@/pages/NotFoundPage"));

function SetupGuard({ children }: { children: React.ReactNode }) {
  const [setupComplete, setSetupComplete] = useState<boolean | null>(() => readSetupStatusCache());
  const { token, logout } = useAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();

  useEffect(() => {
    let cancelled = false;
    setupStatus()
      .then((s) => {
        if (cancelled) return;
        setSetupComplete(s.setup_complete);
        writeSetupStatusCache(s.setup_complete);
      })
      .catch(() => {
        if (!cancelled) setSetupComplete(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  // Human: POST /setup writes setup_complete to sessionStorage before setAuth — sync state before logout guard runs.
  // Agent: READS readSetupStatusCache when token appears; PREVENTS tearing down a fresh post-setup session.
  useEffect(() => {
    if (!token) return;
    if (readSetupStatusCache() === true) {
      setSetupComplete(true);
    }
  }, [token]);

  useEffect(() => {
    if (setupComplete === false && token) {
      if (readSetupStatusCache() === true) {
        setSetupComplete(true);
        return;
      }
      logout();
    }
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

  // Human: Never block the shell on setup/status — routes render while the probe runs in the background.
  // Agent: READS sessionStorage cache for optimistic setupComplete; REDIRECTS via effects when stale.
  return <>{children}</>;
}

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { token, sessionReady } = useAuth();
  const location = useLocation();
  if (!sessionReady) {
    return <RouteLoadingFallback />;
  }
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
  const { token, sessionReady } = useAuth();

  useEffect(() => {
    if (token) prefetchDrivePageChunk();
  }, [token]);

  if (!sessionReady) {
    return <RouteLoadingFallback />;
  }

  return (
    <Suspense fallback={<RouteLoadingFallback />}>
      {token ? <DrivePage /> : <LandingPage />}
    </Suspense>
  );
}

function AuthenticatedDriveShellExtras() {
  const { token, sessionReady, isAdmin } = useAuth();
  // Human: Wait for session restore before admin migration and upload job polling (avoids post-login 401 noise).
  // Agent: READS token + sessionReady; RENDERS trays only when authenticated and bootstrap probe finished.
  if (!token || !sessionReady) return null;
  return (
    <>
      {isAdmin ? <StorageMigrationUi /> : null}
      <TransferPanelStack />
    </>
  );
}

// Human: Sonner toasts follow the drive theme instead of always rendering light.
// Agent: READS resolved theme from ThemeProvider; PASSES it to Toaster's theme prop.
function ThemedToaster() {
  const { resolved } = useTheme();
  return <Toaster richColors closeButton position="top-center" theme={resolved} />;
}

export default function App() {
  return (
    <ThemeProvider>
    <BrowserRouter>
      <AuthProvider>
        <InstanceNameProvider>
        <SetupGuard>
          <RouteErrorBoundary>
          <Suspense fallback={<RouteLoadingFallback />}>
            <Routes>
              <Route path="/setup" element={<SetupPage />} />
              <Route path="/login" element={<LoginPage />} />
              <Route path="/register" element={<RegisterPage />} />
              <Route path="/features" element={<FeaturesPage />} />
              <Route path="/security" element={<SecurityPage />} />
              <Route path="/pricing" element={<PricingPage />} />
              <Route path="/faq" element={<FaqPage />} />
              <Route path="/privacy" element={<PrivacyPolicyPage />} />
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
              <Route
                path="/profile"
                element={
                  <ProtectedRoute>
                    <ProfilePage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/settings"
                element={
                  <ProtectedRoute>
                    <SettingsPage />
                  </ProtectedRoute>
                }
              />
              <Route path="*" element={<NotFoundPage />} />
            </Routes>
          </Suspense>
          </RouteErrorBoundary>
          <AuthenticatedDriveShellExtras />
          <OfflineBanner />
          <ThemedToaster />
        </SetupGuard>
        </InstanceNameProvider>
      </AuthProvider>
    </BrowserRouter>
    </ThemeProvider>
  );
}
