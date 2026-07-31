// Human: First-run wizard — admin, instance, storage + first node dialog, database (4 steps).
// Agent: MULTI-STEP state; CALLS setup; storage node fields edited in SetupStorageNodeDialog.

import { useEffect, useState, type FormEvent } from "react";
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
import { writeSetupStatusCache } from "@/lib/setup-status-cache";
import { clearSetupToken, setSetupToken } from "@/lib/setup-token";
import { getJwtExp } from "@/lib/jwt";
import { SetupActionsRow } from "@/components/setup/SetupActionsRow";
import { SetupConnectionUrlBox } from "@/components/setup/SetupConnectionUrlBox";
import { SetupDbStatusBanner } from "@/components/setup/SetupDbStatusBanner";
import { SetupErrorBanner } from "@/components/setup/SetupErrorBanner";
import { SetupField } from "@/components/setup/SetupField";
import { SetupFormCard } from "@/components/setup/SetupFormCard";
import { SetupOutlineButton } from "@/components/setup/SetupOutlineButton";
import { SetupPageShell } from "@/components/setup/SetupPageShell";
import { SetupPasswordField } from "@/components/setup/SetupPasswordField";
import { SetupReviewSummary } from "@/components/setup/SetupReviewSummary";
import { SetupStepList } from "@/components/setup/SetupStepList";
import {
  SetupStorageNodeDialog,
  validateSetupStorageNodeDraft,
  type SetupStorageNodeDraft,
} from "@/components/setup/SetupStorageNodeDialog";
import { SetupToggleRow } from "@/components/setup/SetupToggleRow";
import type { SetupStepNumber } from "@/components/setup/setup-steps";
import {
  buildPostgresUrl,
  DEFAULT_POSTGRES_URL,
  DOCKER_POSTGRES_DEFAULTS,
  parsePostgresUrl,
  redactPostgresUrl,
  type PostgresConnectionFields,
} from "@/lib/utils-app";

type Step = SetupStepNumber;

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
  const [setupToken, setSetupTokenValue] = useState("");
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
    if (!setupToken.trim()) return;
    let cancelled = false;
    setSetupToken(setupToken);
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
  }, [setupToken]);

  function validateStep1() {
    if (!setupToken.trim()) return "Setup token is required";
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
      if (!res.user) {
        setError("Setup did not return an admin account.");
        return;
      }
      applyInstanceName(instanceName.trim());
      writeSetupStatusCache(true);
      clearSetupToken();
      const sessionExpHint = res.token ? getJwtExp(res.token) : null;
      setAuth(res.user, sessionExpHint);
      navigate("/", { replace: true });
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }

  // Human: One submit path for the whole wizard — Enter in any field advances or finishes.
  // Agent: PREVENTS native submit; step 4 runs handleSubmit, earlier steps validate and move on.
  function handleFormSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (loading) return;
    if (step === 4) {
      void handleSubmit();
      return;
    }
    next();
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

  // Human: Flag a mismatch while typing so step 1 never fails on something the admin could not see.
  const confirmMismatch =
    confirmPassword.length > 0 && password !== confirmPassword ? "Passwords do not match." : null;

  return (
    <SetupPageShell steps={<SetupStepList currentStep={step} />}>
      <SetupFormCard
        currentStep={step}
        onSubmit={handleFormSubmit}
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
        actions={
          <SetupActionsRow
            onBack={() => {
              setError("");
              setStep((s) => Math.max(1, s - 1) as Step);
            }}
            primaryLabel={step === 4 ? "Complete setup" : "Continue"}
            loading={loading}
            loadingLabel={step === 4 ? "Setting up…" : undefined}
            backDisabled={step === 1}
          />
        }
      >
        {step === 1 && (
          <>
            <SetupField
              label="Setup token"
              type="password"
              value={setupToken}
              onChange={(e) => {
                const value = e.target.value;
                setSetupTokenValue(value);
                setSetupToken(value);
              }}
              hint="SETUP_TOKEN from the server environment, printed to the API log on first boot. Entering it loads the database and storage defaults below."
              autoComplete="off"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
            />
            <SetupField
              label="Full name"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              autoComplete="name"
            />
            <SetupField
              label="Email address"
              type="email"
              inputMode="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              hint="Used to sign in. There is no password reset by email yet."
            />
            <SetupPasswordField
              id="setup-password"
              label="Password"
              value={password}
              onChange={setPassword}
              autoComplete="new-password"
              showRequirements
            />
            <SetupPasswordField
              id="setup-confirm-password"
              label="Confirm password"
              value={confirmPassword}
              onChange={setConfirmPassword}
              autoComplete="new-password"
              error={confirmMismatch}
            />
          </>
        )}

        {step === 2 && (
          <>
            <SetupField
              label="Instance name"
              placeholder={DEFAULT_INSTANCE_NAME}
              value={instanceName}
              onChange={(e) => handleInstanceNameChange(e.target.value)}
              hint="Shown in the sidebar and on public share pages."
            />

            <div className="flex flex-col gap-3.5 rounded-md border border-edge px-3.5 py-3.5">
              <SetupToggleRow
                title="Public registration"
                description="Anyone who can reach this instance may create an account"
                checked={allowPublicRegistration}
                onCheckedChange={(checked) => {
                  setAllowPublicRegistration(checked);
                  if (!checked) setRequireAccountActivation(false);
                }}
              />
              <div className="h-px w-full bg-hairline" aria-hidden />
              <SetupToggleRow
                title="Require admin approval"
                description="New accounts stay inactive until an admin activates them"
                checked={requireAccountActivation}
                disabled={!allowPublicRegistration}
                onCheckedChange={setRequireAccountActivation}
              />
            </div>
          </>
        )}

        {step === 3 && (
          <>
            <SetupField
              label="Storage bucket"
              value={storageBucket}
              onChange={(e) => setStorageBucket(e.target.value)}
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              hint="Created on the node if it does not exist."
            />
            <SetupField
              label="Default quota per user (GB)"
              type="number"
              min={1}
              value={quotaGb}
              onChange={(e) => setQuotaGb(e.target.value)}
              hint="Applies to new accounts. Editable per user in the admin console."
            />

            <div className="h-px w-full bg-hairline" aria-hidden />

            {/* Human: Compact node summary + dialog trigger — the node itself is edited in a modal. */}
            <div className="flex flex-col gap-2.5">
              <span className="text-[13px] font-medium text-ink">First storage node</span>
              {storageNodeSaved ? (
                <dl className="divide-y divide-hairline rounded-md border border-edge">
                  <div className="flex items-baseline justify-between gap-4 px-3 py-1.5 text-[13px]">
                    <dt className="shrink-0 text-ink-muted">Node</dt>
                    <dd className="min-w-0 truncate text-right font-medium text-ink">
                      {storageNode.nodeId} · {storageNode.regionLabel}
                    </dd>
                  </div>
                  <div className="flex items-baseline justify-between gap-4 px-3 py-1.5 text-[13px]">
                    <dt className="shrink-0 text-ink-muted">Endpoint</dt>
                    <dd className="min-w-0 truncate text-right font-medium text-ink">
                      {storageNode.baseUrl}
                    </dd>
                  </div>
                  <div className="flex items-baseline justify-between gap-4 px-3 py-1.5 text-[13px]">
                    <dt className="shrink-0 text-ink-muted">Target capacity</dt>
                    <dd className="min-w-0 truncate text-right font-medium text-ink">
                      {nodeSummary}
                    </dd>
                  </div>
                </dl>
              ) : (
                <p className="text-[13px] leading-relaxed text-ink-muted">
                  Not configured yet. Additional nodes can be registered later in the admin console.
                </p>
              )}
              <SetupOutlineButton onClick={() => setStorageNodeDialogOpen(true)}>
                {storageNodeSaved ? "Edit storage node" : "Configure storage node"}
              </SetupOutlineButton>
            </div>
          </>
        )}

        {step === 4 && (
          <>
            <SetupField
              label="Host"
              value={postgresFields.host}
              onChange={(e) => handlePostgresFieldChange("host", e.target.value)}
            />
            <div className="grid grid-cols-2 gap-3 sm:gap-4">
              <SetupField
                label="Port"
                inputMode="numeric"
                value={postgresFields.port}
                onChange={(e) => handlePostgresFieldChange("port", e.target.value)}
              />
              <SetupField
                label="User"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                value={postgresFields.user}
                onChange={(e) => handlePostgresFieldChange("user", e.target.value)}
              />
            </div>
            <SetupPasswordField
              id="setup-db-password"
              label="Password"
              value={postgresFields.password}
              onChange={(value) => handlePostgresFieldChange("password", value)}
              autoComplete="off"
            />
            <SetupField
              label="Database"
              value={postgresFields.database}
              onChange={(e) => handlePostgresFieldChange("database", e.target.value)}
            />
            <SetupConnectionUrlBox url={redactPostgresUrl(databaseUrl)} />
            <SetupOutlineButton onClick={() => void handleTestDatabase()} disabled={dbTesting}>
              {dbTesting ? "Testing…" : "Test connection"}
            </SetupOutlineButton>

            <div className="h-px w-full bg-hairline" aria-hidden />

            <SetupReviewSummary
              adminEmail={email.trim()}
              instanceName={instanceName.trim()}
              publicRegistration={allowPublicRegistration}
              requireApproval={requireAccountActivation}
              storageBucket={storageBucket.trim()}
              quotaGb={quotaGb}
              nodeId={storageNode.nodeId}
              nodeEndpoint={storageNode.baseUrl}
              nodeCapacity={nodeSummary}
            />
          </>
        )}

        <SetupErrorBanner message={error} />
      </SetupFormCard>

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
