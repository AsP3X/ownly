// Human: Password gate before anonymous share content — reuses auth form patterns from login wireframe.
// Agent: CALLS onSubmit from parent; RENDERS AuthFormCard + AuthPasswordField; NO token storage here.

import type { FormEvent } from "react";
import { AuthFormCard } from "@/components/auth/AuthFormCard";
import { AuthPageShell } from "@/components/auth/AuthPageShell";
import { AuthPasswordField } from "@/components/auth/AuthPasswordField";
import { AuthSubmitButton } from "@/components/auth/AuthSubmitButton";
import { Alert, AlertDescription } from "@/components/ui/alert";

type PublicSharePasswordGateProps = {
  resourceType: "file" | "folder";
  shareName: string;
  password: string;
  onPasswordChange: (value: string) => void;
  error: string;
  loading: boolean;
  onSubmit: (event: FormEvent) => void;
};

export function PublicSharePasswordGate({
  resourceType,
  shareName,
  password,
  onPasswordChange,
  error,
  loading,
  onSubmit,
}: PublicSharePasswordGateProps) {
  return (
    <AuthPageShell>
      <AuthFormCard
        title="Password required"
        subtitle={`Enter the password shared with you to view “${shareName}”.`}
      >
        <form onSubmit={onSubmit} className="flex flex-col gap-6">
          <AuthPasswordField
            id="share-password"
            label="Share password"
            value={password}
            onChange={onPasswordChange}
            autoComplete="off"
            required
            aria-invalid={Boolean(error)}
          />

          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}

          <AuthSubmitButton loading={loading} loadingLabel="Unlocking…">
            {resourceType === "folder" ? "Unlock folder" : "Unlock file"}
          </AuthSubmitButton>
        </form>
      </AuthFormCard>
    </AuthPageShell>
  );
}
