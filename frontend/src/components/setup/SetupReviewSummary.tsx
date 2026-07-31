// Human: Final-step recap so the admin can check what "Complete setup" is about to create.
// Agent: PURE presentational; values come from SetupPage state; rendered as a plain definition list.

type SetupReviewSummaryProps = {
  adminEmail: string;
  instanceName: string;
  publicRegistration: boolean;
  requireApproval: boolean;
  storageBucket: string;
  quotaGb: string;
  nodeId: string;
  nodeEndpoint: string;
  nodeCapacity: string;
};

export function SetupReviewSummary({
  adminEmail,
  instanceName,
  publicRegistration,
  requireApproval,
  storageBucket,
  quotaGb,
  nodeId,
  nodeEndpoint,
  nodeCapacity,
}: SetupReviewSummaryProps) {
  const registration = publicRegistration
    ? requireApproval
      ? "Open, admin approval required"
      : "Open"
    : "Invite only";

  const rows: { label: string; value: string }[] = [
    { label: "Admin account", value: adminEmail || "—" },
    { label: "Instance name", value: instanceName || "—" },
    { label: "Registration", value: registration },
    { label: "Storage node", value: nodeId || "—" },
    { label: "Endpoint", value: nodeEndpoint || "—" },
    { label: "Target capacity", value: nodeCapacity },
    { label: "Bucket", value: storageBucket || "—" },
    { label: "Default quota", value: `${quotaGb} GB per user` },
  ];

  return (
    <div className="flex flex-col gap-2">
      <span className="text-[13px] font-medium text-ink">Configuration</span>
      {/* Human: Label over value on phones so a long endpoint wraps instead of being squeezed to nothing. */}
      <dl className="divide-y divide-hairline rounded-md border border-edge">
        {rows.map((row) => (
          <div
            key={row.label}
            className="flex flex-col gap-0.5 px-3 py-2 text-[13px] sm:flex-row sm:items-baseline sm:justify-between sm:gap-4 sm:py-1.5"
          >
            <dt className="shrink-0 text-ink-muted">{row.label}</dt>
            <dd
              className="min-w-0 font-medium break-words text-ink sm:truncate sm:text-right"
              title={row.value}
            >
              {row.value}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
