// Human: Default instance branding used in setup and as a fallback before settings load.
// Agent: READS by setup wizard + InstanceNameProvider; WRITES document.title via applyInstanceDocumentTitle.

export const DEFAULT_INSTANCE_NAME = "Ownly";

/** Human: Keep the browser tab label aligned with the configured instance name. */
export function applyInstanceDocumentTitle(instanceName: string) {
  const trimmed = instanceName.trim() || DEFAULT_INSTANCE_NAME;
  document.title = trimmed;
}
