// Human: Admin dialog for runtime server logging — presets plus per-category level toggles.
// Agent: CALLS fetchAdminLoggingConfig/updateAdminLoggingConfig; PATCH applies live on API.

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, ScrollText } from "lucide-react";
import {
  fetchAdminLoggingConfig,
  getErrorMessage,
  updateAdminLoggingConfig,
  type AdminLoggingConfigResponse,
} from "@/api/client";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AdminConsoleOutlineButton,
  AdminConsolePrimaryButton,
} from "@/components/admin/console/admin-console-ui";

type LoggingPreset = "prod" | "default" | "debug" | "custom";

const PRESET_OPTIONS: {
  id: LoggingPreset;
  label: string;
  description: string;
}[] = [
  {
    id: "prod",
    label: "Production",
    description: "Minimum noise — errors plus important warnings only.",
  },
  {
    id: "default",
    label: "Default",
    description: "Warnings, errors, and important operational events.",
  },
  {
    id: "debug",
    label: "Debug",
    description: "Verbose tracing including SQL and HTTP request details.",
  },
];

function levelLabel(level: string): string {
  return level.charAt(0).toUpperCase() + level.slice(1);
}

/** Human: Modal for atomic logging control — opened from System Settings General tab. */
export function AdminLoggingConfigDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);
  const [serverData, setServerData] = useState<AdminLoggingConfigResponse | null>(null);
  const [preset, setPreset] = useState<LoggingPreset>("default");
  const [categories, setCategories] = useState<Record<string, string>>({});

  const loadConfig = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchAdminLoggingConfig();
      setServerData(data);
      setPreset(data.preset);
      setCategories(data.categories);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) {
      void loadConfig();
      setSavedMessage(null);
    }
  }, [open, loadConfig]);

  const categoryCatalog = serverData?.available_categories ?? [];
  const availableLevels = serverData?.available_levels ?? [
    "off",
    "error",
    "warn",
    "info",
    "debug",
    "trace",
  ];

  const dirty = useMemo(() => {
    if (!serverData) return false;
    if (preset !== serverData.preset) return true;
    for (const cat of categoryCatalog) {
      if ((categories[cat.id] ?? "") !== (serverData.categories[cat.id] ?? "")) {
        return true;
      }
    }
    return false;
  }, [categories, categoryCatalog, preset, serverData]);

  function handlePresetSelect(next: LoggingPreset) {
    setPreset(next);
    setSavedMessage(null);
  }

  const categoriesLockedToPreset =
    preset !== "custom" && serverData !== null && preset !== serverData.preset;

  const displayedCategories = useMemo(() => {
    if (!serverData) return categories;
    if (preset === "custom") return categories;
    if (preset === serverData.preset) return serverData.categories;
    return serverData.categories;
  }, [categories, preset, serverData]);

  function handleCategoryLevelChange(categoryId: string, level: string) {
    setPreset("custom");
    setCategories((current) => ({ ...current, [categoryId]: level }));
    setSavedMessage(null);
  }

  async function handleApplyPreset(next: LoggingPreset) {
    setSaving(true);
    setError(null);
    setSavedMessage(null);
    try {
      const updated = await updateAdminLoggingConfig({ preset: next });
      setServerData(updated);
      setPreset(updated.preset);
      setCategories(updated.categories);
      setSavedMessage(`Applied ${levelLabel(next)} preset.`);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveCustom() {
    setSaving(true);
    setError(null);
    setSavedMessage(null);
    try {
      const body =
        preset === "custom"
          ? { preset: "custom" as const, categories }
          : { preset };
      const updated = await updateAdminLoggingConfig(body);
      setServerData(updated);
      setPreset(updated.preset);
      setCategories(updated.categories);
      setSavedMessage("Logging configuration saved and applied.");
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setError(null);
          setSavedMessage(null);
        }
        onOpenChange(next);
      }}
    >
      <DialogContent
        className="flex max-h-[min(90vh,820px)] max-w-[720px] flex-col gap-0 overflow-hidden rounded-2xl border border-[#E5E7EB] bg-white p-0 sm:max-w-[720px]"
        overlayClassName="bg-[#0F172A66]"
      >
        <div className="border-b border-[#E5E7EB] px-7 py-6">
          <DialogHeader className="gap-1 text-left">
            <DialogTitle className="flex items-center gap-2 text-lg font-semibold text-[#1A1A1A]">
              <ScrollText className="size-5 shrink-0 text-[#666666]" aria-hidden />
              Server logging
            </DialogTitle>
            <DialogDescription className="text-[13px] text-[#666666]">
              Tune what the API writes to its process logs. Changes apply immediately without restart.
              Only affects the Ownly backend — not object storage or other containers.
            </DialogDescription>
          </DialogHeader>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-7 py-5">
          {error ? (
            <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">
              {error}
            </p>
          ) : null}
          {savedMessage ? (
            <p className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
              {savedMessage}
            </p>
          ) : null}

          {loading ? (
            <div className="flex items-center justify-center gap-2 py-16 text-sm text-[#666666]">
              <Loader2 className="size-5 animate-spin" aria-hidden />
              Loading logging settings…
            </div>
          ) : (
            <>
              <section>
                <h3 className="text-sm font-semibold text-[#1A1A1A]">Presets</h3>
                <p className="mt-1 text-[13px] text-[#666666]">
                  Quick bundles — click Apply to save immediately, or pick one then fine-tune categories below.
                </p>
                <div className="mt-3 grid gap-3 sm:grid-cols-3">
                  {PRESET_OPTIONS.map((option) => {
                    const selected = preset === option.id;
                    return (
                      <div
                        key={option.id}
                        className={`rounded-xl border p-4 ${
                          selected ? "border-[#2563EB] bg-[#EFF6FF]" : "border-[#E5E7EB] bg-[#FAFAFA]"
                        }`}
                      >
                        <button
                          type="button"
                          className="w-full text-left"
                          onClick={() => handlePresetSelect(option.id)}
                        >
                          <p className="text-sm font-semibold text-[#1A1A1A]">{option.label}</p>
                          <p className="mt-1 text-[12px] leading-snug text-[#666666]">{option.description}</p>
                        </button>
                        <AdminConsoleOutlineButton
                          className="mt-3 w-full justify-center text-xs"
                          disabled={saving}
                          onClick={() => void handleApplyPreset(option.id)}
                        >
                          Apply
                        </AdminConsoleOutlineButton>
                      </div>
                    );
                  })}
                </div>
              </section>

              <section>
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold text-[#1A1A1A]">Categories</h3>
                    <p className="mt-1 text-[13px] text-[#666666]">
                      Atomic control per subsystem. Changing any level switches to Custom preset.
                      {categoriesLockedToPreset
                        ? " Apply a preset above to refresh category levels."
                        : null}
                    </p>
                  </div>
                  {preset === "custom" ? (
                    <span className="shrink-0 rounded-full bg-[#FEF3C7] px-2.5 py-1 text-[11px] font-medium text-[#92400E]">
                      Custom
                    </span>
                  ) : null}
                </div>

                <div className="mt-3 divide-y divide-[#E5E7EB] rounded-xl border border-[#E5E7EB]">
                  {categoryCatalog.map((category) => (
                    <div
                      key={category.id}
                      className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div className="min-w-0 pr-2">
                        <p className="text-sm font-medium text-[#1A1A1A]">{category.label}</p>
                        <p className="text-[12px] text-[#666666]">{category.description}</p>
                        <p className="mt-0.5 font-mono text-[11px] text-[#9CA3AF]">{category.target}</p>
                      </div>
                      <select
                        aria-label={`Log level for ${category.label}`}
                        className="h-9 min-w-[120px] rounded-lg border border-[#E5E7EB] bg-white px-3 text-sm text-[#1A1A1A]"
                        value={displayedCategories[category.id] ?? "info"}
                        onChange={(event) =>
                          handleCategoryLevelChange(category.id, event.target.value)
                        }
                        disabled={saving || categoriesLockedToPreset}
                      >
                        {availableLevels.map((level) => (
                          <option key={level} value={level}>
                            {levelLabel(level)}
                          </option>
                        ))}
                      </select>
                    </div>
                  ))}
                </div>
              </section>
            </>
          )}
        </div>

        <div className="flex items-center justify-end gap-3 border-t border-[#E5E7EB] px-7 py-4">
          <AdminConsoleOutlineButton onClick={() => onOpenChange(false)} disabled={saving}>
            Close
          </AdminConsoleOutlineButton>
          <AdminConsolePrimaryButton
            onClick={() => void handleSaveCustom()}
            disabled={loading || saving || !dirty}
          >
            {saving ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : (
              "Save & apply"
            )}
          </AdminConsolePrimaryButton>
        </div>
      </DialogContent>
    </Dialog>
  );
}
