// Human: First-run wizard — admin account, instance policy, storage bucket, database connectivity.
// Agent: MULTI-STEP state; CALLS setup/testSetupDatabase/setupStorageInfo; setAuth; navigate "/" on success.

import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  setup,
  setupDatabaseInfo,
  setupStorageInfo,
  testSetupDatabase,
  getErrorMessage,
} from "@/api/client";
import { useAuth } from "@/hooks/useAuth";
import { SetupActionsRow } from "@/components/setup/SetupActionsRow";
import { SetupConnectionUrlBox } from "@/components/setup/SetupConnectionUrlBox";
import { SetupDbStatusBanner } from "@/components/setup/SetupDbStatusBanner";
import { SetupErrorBanner } from "@/components/setup/SetupErrorBanner";
import { SetupField } from "@/components/setup/SetupField";
import { SetupFormCard } from "@/components/setup/SetupFormCard";
import { SetupHeader } from "@/components/setup/SetupHeader";
import { SetupNoticeBox } from "@/components/setup/SetupNoticeBox";
import { SetupOutlineButton } from "@/components/setup/SetupOutlineButton";
import { SetupPageShell } from "@/components/setup/SetupPageShell";
import { SetupToggleRow } from "@/components/setup/SetupToggleRow";
import {
  buildPostgresUrl,
  DEFAULT_POSTGRES_URL,
  DOCKER_POSTGRES_DEFAULTS,
  parsePostgresUrl,
  type PostgresConnectionFields,
} from "@/lib/utils-app";

type Step = 1 | 2 | 3 | 4;

type DbTestResult = {
  ok: boolean;
  message: string;
};

export default function SetupPage() {
  const navigate = useNavigate();
  const { setAuth } = useAuth();

  const [step, setStep] = useState<Step>(1);
  // Agent: fullName is UI-only until setup API accepts a display name (matches RegisterPage pattern).
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [instanceName, setInstanceName] = useState("My Ownly Storage");
  const [allowPublicRegistration, setAllowPublicRegistration] = useState(false);
  const [requireAccountActivation, setRequireAccountActivation] = useState(false);
  const [storageBucket, setStorageBucket] = useState("media");
  const [quotaGb, setQuotaGb] = useState("50");
  const [storageUrl, setStorageUrl] = useState("");
  const [databaseUrl, setDatabaseUrl] = useState(DEFAULT_POSTGRES_URL);
  const [postgresFields, setPostgresFields] = useState<PostgresConnectionFields>(DOCKER_POSTGRES_DEFAULTS);
  const [dbTesting, setDbTesting] = useState(false);
  const [dbTestResult, setDbTestResult] = useState<DbTestResult | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Promise.all([setupDatabaseInfo(), setupStorageInfo()])
      .then(([dbInfo, storageInfo]) => {
        if (cancelled) return;
        setDatabaseUrl(dbInfo.database_url);
        const parsed = parsePostgresUrl(dbInfo.database_url);
        if (parsed) setPostgresFields(parsed);
        setStorageBucket(storageInfo.object_storage_bucket);
        setStorageUrl(storageInfo.object_storage_url);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  function validateStep1() {
    if (!fullName.trim()) return "Full name is required";
    if (!email.trim()) return "Email is required";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return "Invalid email address";
    if (password.length < 8) return "Password must be at least 8 characters";
    if (password !== confirmPassword) return "Passwords do not match";
    return null;
  }

  function validateStep2() {
    if (!instanceName.trim()) return "Instance name is required";
    return null;
  }

  function validateStep3() {
    if (!storageBucket.trim()) return "Storage bucket name is required";
    const quota = Number(quotaGb);
    if (!Number.isFinite(quota) || quota < 1) return "Default quota must be at least 1 GB";
    return null;
  }

  function validateStep4() {
    if (!databaseUrl.trim()) return "Database connection is required";
    return null;
  }

  async function handleTestDatabase() {
    setDbTestResult(null);
    setDbTesting(true);
    try {
      const res = await testSetupDatabase(databaseUrl.trim());
      setDbTestResult({
        ok: true,
        message: `Database connected successfully! (${res.driver})`,
      });
    } catch (e) {
      setDbTestResult({
        ok: false,
        message: `Connection failed: ${getErrorMessage(e)}`,
      });
    } finally {
      setDbTesting(false);
    }
  }

  function next() {
    setError("");
    const validators: Record<Step, () => string | null> = {
      1: validateStep1,
      2: validateStep2,
      3: validateStep3,
      4: validateStep4,
    };
    const err = validators[step]();
    if (err) {
      setError(err);
      return;
    }
    if (step < 4) setStep((step + 1) as Step);
  }

  async function handleSubmit() {
    setError("");
    const err = validateStep4();
    if (err) {
      setError(err);
      return;
    }

    setLoading(true);
    try {
      const res = await setup({
        email: email.trim(),
        password,
        instance_name: instanceName.trim(),
        allow_public_registration: allowPublicRegistration,
        require_account_activation: requireAccountActivation,
        object_storage_bucket: storageBucket.trim(),
        default_storage_quota_gb: Number(quotaGb),
        database_url: databaseUrl.trim(),
      });
      if (res.restart_required) {
        setError(
          `Database configured. Restart the API with DATABASE_URL=${res.configured_database_url ?? databaseUrl}, then sign in.`,
        );
        return;
      }
      if (!res.token) {
        setError("Setup did not return a session token.");
        return;
      }
      setAuth(res.token, res.user);
      navigate("/", { replace: true });
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }

  function handlePostgresFieldChange(field: keyof PostgresConnectionFields, value: string) {
    const next = { ...postgresFields, [field]: value };
    setPostgresFields(next);
    setDatabaseUrl(buildPostgresUrl(next));
    setDbTestResult(null);
  }

  const useCompactHeader = step >= 3;

  return (
    <SetupPageShell>
      <div className="flex w-full max-w-[520px] flex-col gap-8">
        <SetupHeader currentStep={step} compact={useCompactHeader} />

        <SetupFormCard
          gap={step === 3 ? "lg" : "md"}
          stepTitle={step === 3 ? "Storage" : step === 4 ? "Database" : undefined}
          stepSubtitle={
            step === 3
              ? "Configure object storage for documents, images, video, and audio."
              : step === 4
                ? "Verify PostgreSQL connectivity before finishing."
                : undefined
          }
          statusBanner={
            step === 4 && dbTestResult ? (
              <SetupDbStatusBanner
                variant={dbTestResult.ok ? "success" : "error"}
                message={dbTestResult.message}
              />
            ) : undefined
          }
        >
          {step === 1 && (
            <>
              <SetupField
                label="Full Name"
                placeholder="e.g., Alex Johnson"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                autoComplete="name"
              />
              <SetupField
                label="Email Address"
                type="email"
                placeholder="e.g., alex@ownly.sh"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
              />
              <SetupField
                label="Password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
              />
              <SetupField
                label="Confirm Password"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                autoComplete="new-password"
              />
            </>
          )}

          {step === 2 && (
            <>
              <SetupField
                label="Instance Name"
                placeholder="My Ownly Storage"
                value={instanceName}
                onChange={(e) => setInstanceName(e.target.value)}
              />
              <SetupToggleRow
                title="Enable Public Registration"
                description="Allow guests to request user accounts"
                checked={allowPublicRegistration}
                onCheckedChange={(checked) => {
                  setAllowPublicRegistration(checked);
                  if (!checked) setRequireAccountActivation(false);
                }}
              />
              <SetupToggleRow
                title="Require admin approval"
                description="New accounts stay inactive until approved"
                checked={requireAccountActivation}
                disabled={!allowPublicRegistration}
                onCheckedChange={setRequireAccountActivation}
              />
            </>
          )}

          {step === 3 && (
            <>
              <SetupNoticeBox>
                Files are stored in Nebular OS at{" "}
                <span className="font-medium text-[#1A1A1A]">
                  {storageUrl || "http://object-storage:9000"}
                </span>
                .
              </SetupNoticeBox>
              <SetupField
                label="Storage bucket"
                value={storageBucket}
                onChange={(e) => setStorageBucket(e.target.value)}
              />
              <SetupField
                label="Default quota per user (GB)"
                type="number"
                min={1}
                value={quotaGb}
                onChange={(e) => setQuotaGb(e.target.value)}
              />
            </>
          )}

          {step === 4 && (
            <>
              <SetupField
                label="host"
                value={postgresFields.host}
                onChange={(e) => handlePostgresFieldChange("host", e.target.value)}
              />
              <div className="grid grid-cols-2 gap-4">
                <SetupField
                  label="port"
                  value={postgresFields.port}
                  onChange={(e) => handlePostgresFieldChange("port", e.target.value)}
                />
                <SetupField
                  label="user"
                  value={postgresFields.user}
                  onChange={(e) => handlePostgresFieldChange("user", e.target.value)}
                />
              </div>
              <SetupField
                label="password"
                type="password"
                value={postgresFields.password}
                onChange={(e) => handlePostgresFieldChange("password", e.target.value)}
              />
              <SetupField
                label="database"
                value={postgresFields.database}
                onChange={(e) => handlePostgresFieldChange("database", e.target.value)}
              />
              <SetupConnectionUrlBox url={databaseUrl} />
              <SetupOutlineButton onClick={handleTestDatabase} disabled={dbTesting}>
                {dbTesting ? "Testing…" : "Test connection"}
              </SetupOutlineButton>
            </>
          )}

          <SetupErrorBanner message={error} />

          <SetupActionsRow
            onBack={() => {
              setError("");
              setStep((s) => Math.max(1, s - 1) as Step);
            }}
            onPrimary={step === 4 ? handleSubmit : next}
            primaryLabel={step === 4 ? "Complete setup" : "Continue"}
            loading={loading}
            loadingLabel={step === 4 ? "Setting up…" : undefined}
            backDisabled={step === 1}
          />
        </SetupFormCard>
      </div>
    </SetupPageShell>
  );
}
