// Human: Detects login and navigation messages that mean the account is waiting for admin approval.
// Agent: USED by LoginPage to open AccountNotActivatedDialog instead of inline alerts.

const PENDING_ACTIVATION_INFO =
  "An administrator must approve your account before you can sign in.";

export function isAccountActivationBlockedMessage(message: string): boolean {
  const normalized = message.trim().toLowerCase();
  return (
    normalized.includes("not activated") ||
    message.trim() === PENDING_ACTIVATION_INFO
  );
}
