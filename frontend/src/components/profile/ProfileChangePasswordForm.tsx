// Human: Self-service password rotation form on the profile page.
// Agent: CALLS changeOwnPassword; VALIDATES client-side; SHOWS API errors inline.

import { useState } from "react";
import { changeOwnPassword, getErrorMessage } from "@/api/client";
import { AuthPasswordField } from "@/components/auth/AuthPasswordField";
import { ProfileSectionCard } from "@/components/profile/profile-ui";
import { Alert, AlertDescription } from "@/components/ui/alert";

/** Human: Security section — verify current password before accepting a new one. */
export function ProfileChangePasswordForm() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    setSuccess("");

    if (newPassword.length < 8) {
      setError("New password must be at least 8 characters.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("New password and confirmation do not match.");
      return;
    }

    setSubmitting(true);
    try {
      await changeOwnPassword(currentPassword, newPassword);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setSuccess("Password updated successfully.");
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <ProfileSectionCard
      title="Security"
      description="Change your password. You will stay signed in on this device."
    >
      <form className="flex max-w-md flex-col gap-4" onSubmit={(event) => void handleSubmit(event)}>
        <AuthPasswordField
          id="profile-current-password"
          label="Current password"
          value={currentPassword}
          onChange={setCurrentPassword}
          autoComplete="current-password"
          required
        />
        <AuthPasswordField
          id="profile-new-password"
          label="New password"
          value={newPassword}
          onChange={setNewPassword}
          autoComplete="new-password"
          required
        />
        <AuthPasswordField
          id="profile-confirm-password"
          label="Confirm new password"
          value={confirmPassword}
          onChange={setConfirmPassword}
          autoComplete="new-password"
          required
        />

        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        {success ? (
          <Alert>
            <AlertDescription>{success}</AlertDescription>
          </Alert>
        ) : null}

        <div>
          <button
            type="submit"
            disabled={submitting}
            className="inline-flex items-center justify-center rounded-lg bg-[#2563EB] px-4 py-2.5 text-sm font-bold text-white transition-colors hover:bg-[#1D4ED8] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting ? "Updating…" : "Update password"}
          </button>
        </div>
      </form>
    </ProfileSectionCard>
  );
}
