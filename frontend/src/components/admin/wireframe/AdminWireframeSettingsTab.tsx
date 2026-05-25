// Human: Settings tab — detailed instance configuration with left-rail categories (wireframe).
// Agent: RENDERS forms mirroring setup wizard + admin API; Save is visual-only until wired.

import { useState } from "react";
import {
  Cloud,
  Globe,
  HardDrive,
  Mail,
  Plug,
  Settings2,
  Share2,
  Shield,
  Upload,
  Wrench,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import {
  SettingsRow,
  SettingsSection,
  Switch,
  WireframePageHeader,
} from "@/components/admin/wireframe/wireframe-primitives";

const SETTINGS_SECTIONS = [
  { id: "general", label: "General", icon: Settings2 },
  { id: "registration", label: "Registration", icon: Globe },
  { id: "storage", label: "Storage & quotas", icon: HardDrive },
  { id: "uploads", label: "Uploads", icon: Upload },
  { id: "sharing", label: "Sharing", icon: Share2 },
  { id: "email", label: "Email", icon: Mail },
  { id: "security", label: "Security", icon: Shield },
  { id: "integrations", label: "Integrations", icon: Plug },
  { id: "maintenance", label: "Maintenance", icon: Wrench },
] as const;

type SettingsSectionId = (typeof SETTINGS_SECTIONS)[number]["id"];

/** Human: Full settings workspace — every major instance knob in one scrollable panel. */
export function AdminWireframeSettingsTab() {
  const [activeSection, setActiveSection] = useState<SettingsSectionId>("general");

  return (
    <div className="flex flex-col gap-6">
      <WireframePageHeader
        title="Settings"
        description="Configure your MediaVault instance in detail. Changes are preview-only in this wireframe."
        actions={
          <>
            <Button type="button" variant="outline" className="border-neutral-200">
              Discard
            </Button>
            <Button type="button" className="bg-blue-600 hover:bg-blue-700">
              Save changes
            </Button>
          </>
        }
      />

      <div className="grid min-h-[480px] gap-6 lg:grid-cols-[220px_minmax(0,1fr)]">
        <nav
          className="flex flex-row gap-1 overflow-x-auto rounded-lg border border-neutral-200 bg-neutral-50/50 p-2 lg:flex-col lg:overflow-visible"
          aria-label="Settings categories"
        >
          {SETTINGS_SECTIONS.map((section) => {
            const Icon = section.icon;
            const active = activeSection === section.id;
            return (
              <button
                key={section.id}
                type="button"
                onClick={() => setActiveSection(section.id)}
                className={cn(
                  "flex shrink-0 items-center gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors",
                  active
                    ? "bg-white font-medium text-blue-700 shadow-sm ring-1 ring-neutral-200"
                    : "text-neutral-600 hover:bg-white/80 hover:text-neutral-900",
                )}
              >
                <Icon className="size-4 shrink-0" aria-hidden />
                {section.label}
              </button>
            );
          })}
        </nav>

        <div className="flex flex-col gap-8">
          {activeSection === "general" && (
            <>
              <SettingsSection title="Instance identity">
                <SettingsRow label="Instance name" description="Shown in the browser title and emails">
                  <Input className="w-full max-w-xs border-neutral-200" defaultValue="MediaVault" />
                </SettingsRow>
                <SettingsRow label="Public URL" description="Base URL for share links and redirects">
                  <Input className="w-full max-w-md border-neutral-200" defaultValue="https://cloud.example.com" />
                </SettingsRow>
                <SettingsRow label="Support contact" description="Displayed on error pages">
                  <Input className="w-full max-w-xs border-neutral-200" defaultValue="admin@example.com" />
                </SettingsRow>
                <SettingsRow label="Maintenance mode" description="Only administrators can sign in">
                  <Switch />
                </SettingsRow>
              </SettingsSection>
              <SettingsSection title="Branding">
                <SettingsRow label="Custom logo URL" description="Optional · replaces default cloud icon">
                  <Input className="w-full max-w-md border-neutral-200" placeholder="https://…" />
                </SettingsRow>
                <SettingsRow label="Accent color" description="Primary buttons and links">
                  <Input className="w-24 border-neutral-200 font-mono text-sm" defaultValue="#2563eb" />
                </SettingsRow>
              </SettingsSection>
            </>
          )}

          {activeSection === "registration" && (
            <SettingsSection
              title="Accounts & registration"
              description="Matches setup wizard step 2 — public signup and approval"
            >
              <SettingsRow
                label="Allow public registration"
                description="Let users create their own accounts from /register"
              >
                <Switch defaultChecked />
              </SettingsRow>
              <SettingsRow
                label="Require admin approval"
                description="New accounts stay inactive until an administrator approves"
              >
                <Switch defaultChecked />
              </SettingsRow>
              <SettingsRow label="Default role for new users" description="Before group assignments apply">
                <Input className="max-w-[160px] border-neutral-200" defaultValue="user" readOnly />
              </SettingsRow>
              <SettingsRow label="Minimum password length" description="Enforced on register and password change">
                <Input className="max-w-[80px] border-neutral-200 text-right" defaultValue="12" readOnly />
              </SettingsRow>
              <SettingsRow label="Password require symbols" description="Additional complexity rule">
                <Switch defaultChecked />
              </SettingsRow>
            </SettingsSection>
          )}

          {activeSection === "storage" && (
            <>
              <SettingsSection title="Object storage (Nebular OS)" description="Setup wizard step 3">
                <SettingsRow label="Storage endpoint" description="Internal or public URL for health checks">
                  <Input className="w-full max-w-md border-neutral-200 font-mono text-xs" defaultValue="http://object-storage:9000" />
                </SettingsRow>
                <SettingsRow label="Default bucket" description="Primary bucket for user files">
                  <Input className="max-w-xs border-neutral-200" defaultValue="mediavault" />
                </SettingsRow>
                <SettingsRow label="Default quota per user (GB)" description="Applied to new accounts">
                  <Input className="max-w-[80px] border-neutral-200 text-right" defaultValue="50" readOnly />
                </SettingsRow>
                <SettingsRow label="Global storage cap (TB)" description="Hard stop for entire instance">
                  <Input className="max-w-[80px] border-neutral-200 text-right" defaultValue="10" readOnly />
                </SettingsRow>
              </SettingsSection>
              <SettingsSection title="Database">
                <SettingsRow label="PostgreSQL URL" description="Read-only in UI · change via env in production">
                  <Input
                    className="w-full max-w-md border-neutral-200 font-mono text-xs"
                    defaultValue="postgres://…"
                    type="password"
                  />
                </SettingsRow>
                <SettingsRow label="Run vacuum on schedule" description="Weekly maintenance window">
                  <Switch defaultChecked />
                </SettingsRow>
              </SettingsSection>
            </>
          )}

          {activeSection === "uploads" && (
            <SettingsSection title="Upload limits & processing">
              <SettingsRow label="Max upload size (MB)" description="Maps to MAX_UPLOAD_BYTES on API">
                <Input className="max-w-[100px] border-neutral-200 text-right" defaultValue="5120" readOnly />
              </SettingsRow>
              <SettingsRow label="Allowed MIME types" description="Empty = allow all · comma-separated list">
                <Input className="w-full max-w-md border-neutral-200" placeholder="image/*, video/*, application/pdf" />
              </SettingsRow>
              <SettingsRow label="Block dangerous extensions" description=".exe, .bat, .scr, etc.">
                <Switch defaultChecked />
              </SettingsRow>
              <SettingsRow label="Virus scan uploads" description="Integrate ClamAV or external scanner">
                <Switch />
              </SettingsRow>
              <SettingsRow label="Generate video thumbnails" description="Background job after upload completes">
                <Switch defaultChecked />
              </SettingsRow>
            </SettingsSection>
          )}

          {activeSection === "sharing" && (
            <SettingsSection title="Sharing & public links">
              <SettingsRow label="Allow public share links" description="Anyone with link can access within expiry">
                <Switch defaultChecked />
              </SettingsRow>
              <SettingsRow label="Default link expiry (days)" description="0 = never expires">
                <Input className="max-w-[80px] border-neutral-200 text-right" defaultValue="30" readOnly />
              </SettingsRow>
              <SettingsRow label="Require password on public links" description="Optional second factor for guests">
                <Switch />
              </SettingsRow>
              <SettingsRow label="Max downloads per link" description="Leave empty for unlimited">
                <Input className="max-w-[80px] border-neutral-200 text-right" placeholder="∞" />
              </SettingsRow>
            </SettingsSection>
          )}

          {activeSection === "email" && (
            <SettingsSection title="Email & notifications" description="SMTP for approvals, alerts, and digests">
              <SettingsRow label="Enable outbound email" description="Required for password reset and invites">
                <Switch />
              </SettingsRow>
              <SettingsRow label="SMTP host">
                <Input className="max-w-xs border-neutral-200" placeholder="smtp.example.com" />
              </SettingsRow>
              <SettingsRow label="SMTP port">
                <Input className="max-w-[80px] border-neutral-200" defaultValue="587" />
              </SettingsRow>
              <SettingsRow label="From address">
                <Input className="max-w-xs border-neutral-200" defaultValue="noreply@example.com" />
              </SettingsRow>
              <Separator className="my-2 bg-neutral-100" />
              <SettingsRow label="Weekly admin digest" description="Summary of usage and security events">
                <Switch defaultChecked />
              </SettingsRow>
              <SettingsRow label="Quota warning emails" description="Notify users at 80% and 95%">
                <Switch defaultChecked />
              </SettingsRow>
            </SettingsSection>
          )}

          {activeSection === "security" && (
            <SettingsSection title="Security policies">
              <SettingsRow label="Force HTTPS" description="Redirect HTTP to TLS">
                <Switch defaultChecked />
              </SettingsRow>
              <SettingsRow label="HSTS max-age (seconds)">
                <Input className="max-w-[120px] border-neutral-200 text-right" defaultValue="31536000" readOnly />
              </SettingsRow>
              <SettingsRow label="Audit log retention (days)" description="Older rows archived or purged">
                <Input className="max-w-[80px] border-neutral-200 text-right" defaultValue="365" readOnly />
              </SettingsRow>
              <SettingsRow label="IP allowlist for admin" description="CIDR list · empty = any">
                <Input className="w-full max-w-md border-neutral-200" placeholder="10.0.0.0/8" />
              </SettingsRow>
            </SettingsSection>
          )}

          {activeSection === "integrations" && (
            <SettingsSection title="API & webhooks">
              <SettingsRow label="Enable API keys" description="Service accounts for automation">
                <Switch defaultChecked />
              </SettingsRow>
              <SettingsRow label="Webhook URL" description="POST JSON on file.upload, user.created, etc.">
                <Input className="w-full max-w-md border-neutral-200" placeholder="https://hooks.example.com/ownly" />
              </SettingsRow>
              <SettingsRow label="Webhook secret" description="HMAC signature header">
                <Input className="w-full max-w-xs border-neutral-200" type="password" defaultValue="••••••••" />
              </SettingsRow>
            </SettingsSection>
          )}

          {activeSection === "maintenance" && (
            <>
              <SettingsSection title="Backups & jobs">
                <SettingsRow label="Automated backup schedule" description="Database + metadata export">
                  <Input className="max-w-[160px] border-neutral-200" defaultValue="Daily 03:00 UTC" readOnly />
                </SettingsRow>
                <SettingsRow label="Last successful backup">
                  <span className="text-sm text-neutral-600">Today 03:12 UTC · 1.8 GB</span>
                </SettingsRow>
                <SettingsRow label="Recompression job" description="Nebular legacy blob optimization">
                  <Switch defaultChecked />
                </SettingsRow>
              </SettingsSection>
              <SettingsSection
                title="Danger zone"
                footer={
                  <Button type="button" variant="outline" className="border-rose-200 text-rose-700 hover:bg-rose-50">
                    Purge soft-deleted blobs
                  </Button>
                }
              >
                <SettingsRow
                  label="Export all settings"
                  description="Download JSON snapshot for disaster recovery"
                >
                  <Button type="button" variant="outline" size="sm" className="border-neutral-200">
                    Export
                  </Button>
                </SettingsRow>
              </SettingsSection>
            </>
          )}

          <p className="flex items-center gap-2 text-xs text-neutral-400">
            <Cloud className="size-3.5" />
            Settings map to GET/PATCH /api/v1/admin/settings when implemented
          </p>
        </div>
      </div>
    </div>
  );
}
