// Human: Application shell — setup gate, auth routes, and the main drive experience.
// Agent: WRAPS BrowserRouter+AuthProvider; SetupGuard reads setupStatus; lazy-loads route chunks via Suspense.

import { lazy, Suspense, useEffect, useState } from "react";
import { BrowserRouter, Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { setupStatus } from "@/api/client";
import { RouteLoadingFallback } from "@/components/RouteLoadingFallback";
import { AuthProvider } from "@/context/AuthContext";
import { InstanceNameProvider } from "@/context/InstanceNameContext";
import { useAuth } from "@/hooks/useAuth";
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
  const { token } = useAuth();
  // Human: Public share visitors are anonymous — skip admin migration and upload job polling (401 noise).
  // Agent: READS token; RENDERS StorageMigrationUi + TransferPanelStack only when authenticated.
  if (!token) return null;
  return (
    <>
      <StorageMigrationUi />
      <TransferPanelStack />
    </>
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
          <AuthenticatedDriveShellExtras />
        </SetupGuard>
        </InstanceNameProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}
