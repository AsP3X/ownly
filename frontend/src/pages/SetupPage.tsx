// Human: First-run wizard — admin account, instance policy, storage bucket, database connectivity.
// Agent: MULTI-STEP state; CALLS setup/testSetupDatabase/setupStorageInfo; setAuth; navigate "/" on success.

import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Cloud, Database, HardDrive, ShieldCheck } from "lucide-react";
import {
  setup,
  setupDatabaseInfo,
  setupStorageInfo,
  testSetupDatabase,
  getErrorMessage,
} from "@/api/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
import {
  buildPostgresUrl,
  DEFAULT_POSTGRES_URL,
  DOCKER_POSTGRES_DEFAULTS,
  parsePostgresUrl,
  type PostgresConnectionFields,
} from "@/lib/utils-app";

type Step = 1 | 2 | 3 | 4;

const steps = [
  { id: 1, title: "Admin", icon: ShieldCheck },
  { id: 2, title: "Instance", icon: Cloud },
  { id: 3, title: "Storage", icon: HardDrive },
  { id: 4, title: "Database", icon: Database },
] as const;

export default function SetupPage() {
  const navigate = useNavigate();
  const { setAuth } = useAuth();

  const [step, setStep] = useState<Step>(1);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [instanceName, setInstanceName] = useState("MediaVault");
  const [allowPublicRegistration, setAllowPublicRegistration] = useState(false);
  const [requireAccountActivation, setRequireAccountActivation] = useState(false);
  const [storageBucket, setStorageBucket] = useState("media");
  const [quotaGb, setQuotaGb] = useState("50");
  const [storageUrl, setStorageUrl] = useState("");
  const [databaseUrl, setDatabaseUrl] = useState(DEFAULT_POSTGRES_URL);
  const [postgresFields, setPostgresFields] = useState<PostgresConnectionFields>(DOCKER_POSTGRES_DEFAULTS);
  const [dbTesting, setDbTesting] = useState(false);
  const [dbTestMessage, setDbTestMessage] = useState<string | null>(null);
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
    setDbTestMessage(null);
    setDbTesting(true);
    try {
      const res = await testSetupDatabase(databaseUrl.trim());
      setDbTestMessage(`Connected successfully (${res.driver}).`);
    } catch (e) {
      setDbTestMessage(getErrorMessage(e));
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

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-lg flex flex-col gap-6">
        <div className="text-center flex flex-col gap-2">
          <div className="mx-auto size-12 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
            <Cloud className="size-6" data-icon="inline-start" />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">Welcome to MediaVault</h1>
          <p className="text-sm text-muted-foreground">
            Configure your personal cloud storage in a few steps.
          </p>
        </div>

        <div className="flex items-center justify-center gap-2">
          {steps.map((s, index) => (
            <div key={s.id} className="flex items-center gap-2">
              <div
                className={`size-8 rounded-full flex items-center justify-center text-xs font-medium border ${
                  step === s.id
                    ? "bg-primary text-primary-foreground border-primary"
                    : step > s.id
                      ? "bg-primary/10 text-primary border-primary/30"
                      : "bg-muted text-muted-foreground border-border"
                }`}
              >
                {s.id}
              </div>
              {index < steps.length - 1 && (
                <div className={`w-8 h-px ${step > s.id ? "bg-primary/40" : "bg-border"}`} />
              )}
            </div>
          ))}
        </div>

        <Card>
          <CardHeader>
            <CardTitle>{steps[step - 1].title}</CardTitle>
            <CardDescription>
              {step === 1 && "Create the root administrator account."}
              {step === 2 && "Name your instance and set registration policy."}
              {step === 3 && "Configure object storage for documents, images, video, and audio."}
              {step === 4 && "Verify PostgreSQL connectivity before finishing."}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {step === 1 && (
              <>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="email">Email</Label>
                  <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="admin@example.com" />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="password">Password</Label>
                  <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="confirm">Confirm password</Label>
                  <Input id="confirm" type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} />
                </div>
              </>
            )}

            {step === 2 && (
              <>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="instance">Instance name</Label>
                  <Input id="instance" value={instanceName} onChange={(e) => setInstanceName(e.target.value)} />
                </div>
                <div className="flex items-center justify-between gap-4">
                  <div className="flex flex-col gap-1">
                    <Label>Allow public registration</Label>
                    <p className="text-xs text-muted-foreground">Let users create their own accounts</p>
                  </div>
                  <Switch
                    checked={allowPublicRegistration}
                    onCheckedChange={(checked) => {
                      setAllowPublicRegistration(checked);
                      if (!checked) setRequireAccountActivation(false);
                    }}
                  />
                </div>
                <div className={`flex items-center justify-between gap-4 ${!allowPublicRegistration ? "opacity-50" : ""}`}>
                  <div className="flex flex-col gap-1">
                    <Label>Require admin approval</Label>
                    <p className="text-xs text-muted-foreground">New accounts stay inactive until approved</p>
                  </div>
                  <Switch
                    checked={requireAccountActivation}
                    disabled={!allowPublicRegistration}
                    onCheckedChange={setRequireAccountActivation}
                  />
                </div>
              </>
            )}

            {step === 3 && (
              <>
                <Alert>
                  <AlertDescription>
                    Files are stored in Nebular OS at{" "}
                    <span className="font-mono text-xs">{storageUrl || "object-storage:9000"}</span>.
                  </AlertDescription>
                </Alert>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="bucket">Storage bucket</Label>
                  <Input id="bucket" value={storageBucket} onChange={(e) => setStorageBucket(e.target.value)} />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="quota">Default quota per user (GB)</Label>
                  <Input id="quota" type="number" min={1} value={quotaGb} onChange={(e) => setQuotaGb(e.target.value)} />
                </div>
              </>
            )}

            {step === 4 && (
              <>
                <div className="grid grid-cols-2 gap-3">
                  {(["host", "port", "user", "password", "database"] as const).map((field) => (
                    <div key={field} className={`flex flex-col gap-2 ${field === "host" || field === "database" ? "col-span-2" : ""}`}>
                      <Label>{field}</Label>
                      <Input
                        value={postgresFields[field]}
                        type={field === "password" ? "password" : "text"}
                        onChange={(e) => {
                          const next = { ...postgresFields, [field]: e.target.value };
                          setPostgresFields(next);
                          setDatabaseUrl(buildPostgresUrl(next));
                          setDbTestMessage(null);
                        }}
                      />
                    </div>
                  ))}
                </div>
                <Separator />
                <div className="flex flex-col gap-2">
                  <Label>Connection URL</Label>
                  <p className="text-xs font-mono break-all text-muted-foreground">{databaseUrl}</p>
                </div>
                <Button type="button" variant="outline" onClick={handleTestDatabase} disabled={dbTesting}>
                  {dbTesting ? "Testing…" : "Test connection"}
                </Button>
                {dbTestMessage && (
                  <Alert>
                    <AlertDescription>{dbTestMessage}</AlertDescription>
                  </Alert>
                )}
              </>
            )}

            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <div className="flex items-center justify-between pt-2">
              <Button type="button" variant="ghost" disabled={step === 1 || loading} onClick={() => setStep((s) => Math.max(1, s - 1) as Step)}>
                Back
              </Button>
              <Button type="button" onClick={step === 4 ? handleSubmit : next} disabled={loading}>
                {loading ? "Setting up…" : step === 4 ? "Complete setup" : "Continue"}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
