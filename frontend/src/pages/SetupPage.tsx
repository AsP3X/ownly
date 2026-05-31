// Human: First-run wizard — admin, instance, storage + first node dialog, database (4 steps).
// Agent: MULTI-STEP state; CALLS setup; storage node fields edited in SetupStorageNodeDialog.

import { useEffect, useState } from "react";
import { Server } from "lucide-react";
import { useNavigate } from "react-router-dom";
import {
  setup,
  setupDatabaseInfo,
  setupStorageInfo,
  testSetupDatabase,
  getErrorMessage,
} from "@/api/client";
import { useInstanceName } from "@/hooks/useInstanceName";
import { useAuth } from "@/hooks/useAuth";
import { DEFAULT_INSTANCE_NAME } from "@/lib/instance-name";
import { SetupActionsRow } from "@/components/setup/SetupActionsRow";
import { SetupConnectionUrlBox } from "@/components/setup/SetupConnectionUrlBox";
import { SetupDbStatusBanner } from "@/components/setup/SetupDbStatusBanner";
import { SetupErrorBanner } from "@/components/setup/SetupErrorBanner";
import { SetupField } from "@/components/setup/SetupField";
import { SetupFormCard } from "@/components/setup/SetupFormCard";
import { SetupHeader } from "@/components/setup/SetupHeader";
import { SetupOutlineButton } from "@/components/setup/SetupOutlineButton";
import { SetupPageShell } from "@/components/setup/SetupPageShell";
import {
  SetupStorageNodeDialog,
  validateSetupStorageNodeDraft,
  type SetupStorageNodeDraft,
} from "@/components/setup/SetupStorageNodeDialog";
import { SetupToggleRow } from "@/components/setup/SetupToggleRow";
import {
  buildPostgresUrl,
  DEFAULT_POSTGRES_URL,
  DOCKER_POSTGRES_DEFAULTS,
  parsePostgresUrl,
  type PostgresConnectionFields,
} from "@/lib/utils-app";

type Step = 1 | 2 | 3 | 4;

type ConnectionTestResult = {
  ok: boolean;
  message: string;
};

const DEFAULT_NODE_DRAFT: SetupStorageNodeDraft = {
  nodeId: "node-primary",
  regionLabel: DEFAULT_INSTANCE_NAME,
  baseUrl: "",
  capacityValue: "512",
  capacityUnit: "GB",
};

export default function SetupPage() {
  const navigate = useNavigate();
  const { setAuth } = useAuth();
  const { setInstanceName: applyInstanceName } = useInstanceName();

  const [step, setStep] = useState<Step>(1);
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [instanceName, setInstanceName] = useState(DEFAULT_INSTANCE_NAME);
  const [allowPublicRegistration, setAllowPublicRegistration] = useState(false);
  const [requireAccountActivation, setRequireAccountActivation] = useState(false);
  const [storageBucket, setStorageBucket] = useState("media");
  const [quotaGb, setQuotaGb] = useState("50");
  const [storageNode, setStorageNode] = useState<SetupStorageNodeDraft>(DEFAULT_NODE_DRAFT);
  const [storageNodeSaved, setStorageNodeSaved] = useState(false);
  const [storageNodeDialogOpen, setStorageNodeDialogOpen] = useState(false);
  const [databaseUrl, setDatabaseUrl] = useState(DEFAULT_POSTGRES_URL);
  const [postgresFields, setPostgresFields] = useState<PostgresConnectionFields>(DOCKER_POSTGRES_DEFAULTS);
  const [dbTesting, setDbTesting] = useState(false);
  const [dbTestResult, setDbTestResult] = useState<ConnectionTestResult | null>(null);
  const [storageTestResult, setStorageTestResult] = useState<ConnectionTestResult | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  // Human: Keep the first storage node's region label aligned with the instance name field.
  // Agent: WRITES instanceName + storageNode.regionLabel together on each keystroke.
  function handleInstanceNameChange(value: string) {
    setInstanceName(value);
    const trimmed = value.trim() || DEFAULT_INSTANCE_NAME;
    setStorageNode((prev) => ({ ...prev, regionLabel: trimmed }));
  }

  useEffect(() => {
    let cancelled = false;
    Promise.all([setupDatabaseInfo(), setupStorageInfo()])
      .then(([dbInfo, storageInfo]) => {
        if (cancelled) return;
        setDatabaseUrl(dbInfo.database_url);
        const parsed = parsePostgresUrl(dbInfo.database_url);
        if (parsed) setPostgresFields(parsed);
        setStorageBucket(storageInfo.object_storage_bucket);
        setStorageNode((prev) => ({
          ...prev,
          baseUrl: storageInfo.object_storage_url,
        }));
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
    if (!storageNodeSaved) return "Configure your first storage node before continuing";
    return validateSetupStorageNodeDraft(storageNode);
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
    if (step === 2) {
      setStorageNode((prev) => ({ ...prev, regionLabel: instanceName.trim() }));
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
      const capacity = Number.parseFloat(storageNode.capacityValue);
      const res = await setup({
        email: email.trim(),
        password,
        instance_name: instanceName.trim(),
        allow_public_registration: allowPublicRegistration,
        require_account_activation: requireAccountActivation,
        object_storage_bucket: storageBucket.trim(),
        default_storage_quota_gb: Number(quotaGb),
        database_url: databaseUrl.trim(),
        storage_node_id: storageNode.nodeId.trim(),
        storage_node_region_label: storageNode.regionLabel.trim(),
        storage_node_base_url: storageNode.baseUrl.trim(),
        storage_node_target_capacity_value: capacity,
        storage_node_target_capacity_unit: storageNode.capacityUnit,
      });
      if (res.restart_required) {
        const parts = [
          res.configured_database_url
            ? `DATABASE_URL=${res.configured_database_url}`
            : null,
          res.configured_object_storage_url
            ? `OBJECT_STORAGE_URL=${res.configured_object_storage_url}`
            : null,
        ].filter(Boolean);
        setError(
          `Configuration saved. Restart the API with ${parts.join(" and ")}, then sign in.`,
        );
        return;
      }
      if (!res.token) {
        setError("Setup did not return a session token.");
        return;
      }
      applyInstanceName(instanceName.trim());
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

  function handleStorageNodeSave(draft: SetupStorageNodeDraft) {
    setStorageNode(draft);
    setStorageNodeSaved(true);
    setError("");
  }

  const nodeSummary = `${storageNode.capacityValue} ${storageNode.capacityUnit}`;
  const useCompactHeader = step >= 3;

  return (
    <SetupPageShell>
      <div className="flex w-full max-w-[520px] flex-col gap-8">
        <SetupHeader currentStep={step} compact={useCompactHeader} />

        <SetupFormCard
          gap={step >= 3 ? "lg" : "md"}
          stepTitle={step === 3 ? "Storage" : step === 4 ? "Database" : undefined}
          stepSubtitle={
            step === 3
              ? "Configure object storage for documents, images, video, and audio."
              : step === 4
                ? "Verify PostgreSQL connectivity before finishing."
                : undefined
          }
          statusBanner={
            step === 3 && storageTestResult ? (
              <SetupDbStatusBanner
                variant={storageTestResult.ok ? "success" : "error"}
                message={storageTestResult.message}
              />
            ) : step === 4 && dbTestResult ? (
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
                placeholder={DEFAULT_INSTANCE_NAME}
                value={instanceName}
                onChange={(e) => handleInstanceNameChange(e.target.value)}
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

              <div className="h-px w-full bg-[#E5E7EB]" aria-hidden />

              {/* Human: Compact node summary + dialog trigger per setup storage step design. */}
              <div className="flex flex-col gap-3">
                <p className="text-[13px] font-semibold text-[#1A1A1A]">First storage node</p>
                {storageNodeSaved ? (
                  <div className="rounded-lg border border-[#E5E7EB] bg-[#F7F8FA] px-4 py-3 text-sm">
                    <p className="font-semibold text-[#1A1A1A]">
                      {storageNode.nodeId}{" "}
                      <span className="font-normal text-[#666666]">· {storageNode.regionLabel}</span>
                    </p>
                    <p className="mt-1 truncate text-[#666666]">{storageNode.baseUrl}</p>
                    <p className="mt-1 text-xs text-[#888888]">{nodeSummary}</p>
                  </div>
                ) : (
                  <p className="text-sm text-[#666666]">
                    Register your Nebular OS endpoint before continuing setup.
                  </p>
                )}
                <SetupOutlineButton onClick={() => setStorageNodeDialogOpen(true)}>
                  <Server className="size-4" aria-hidden />
                  {storageNodeSaved ? "Edit storage node" : "Configure storage node"}
                </SetupOutlineButton>
              </div>
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
              <SetupOutlineButton onClick={() => void handleTestDatabase()} disabled={dbTesting}>
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

      <SetupStorageNodeDialog
        open={storageNodeDialogOpen}
        onOpenChange={setStorageNodeDialogOpen}
        value={storageNode}
        onSave={handleStorageNodeSave}
        onTestSuccess={(message) => setStorageTestResult({ ok: true, message })}
      />
    </SetupPageShell>
  );
}

