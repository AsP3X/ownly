// Human: Storage and security wireframe tabs — infrastructure monitoring and policies.
// Agent: RENDERS Nebular/Postgres health placeholders aligned with setup wizard fields.

import { Database, HardDrive, KeyRound, Lock } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import {
  DonutPlaceholder,
  SettingsRow,
  SettingsSection,
  StatCard,
  WireframePageHeader,
} from "@/components/admin/wireframe/wireframe-primitives";
import { Switch } from "@/components/ui/switch";

/** Human: Object storage and database utilization wireframe. */
export function AdminWireframeStorageTab() {
  return (
    <div className="flex flex-col gap-6">
      <WireframePageHeader
        title="Storage"
        description="Nebular OS buckets, compression stats, and per-user quota overview."
        actions={
          <Button type="button" variant="outline" className="border-neutral-200">
            Test connection
          </Button>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Pool used" value="2.4 TB" hint="of 3.5 TB allocated" />
        <StatCard label="Compression saved" value="412 GB" hint="Zstd store-if-smaller" trend="up" trendLabel="+8%" />
        <StatCard label="Blob count" value="1.2M" hint="Nebular OS objects" />
        <StatCard label="Reclaim queue" value="128" hint="Soft-deleted pending purge" />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="border-neutral-200 shadow-none">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <HardDrive className="size-4 text-blue-600" />
              Nebular OS
            </CardTitle>
            <CardDescription>object-storage:9000 · bucket mediavault</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <div className="flex justify-between text-xs text-neutral-600">
                <span>Bucket utilization</span>
                <span className="tabular-nums">68%</span>
              </div>
              <Progress value={68} className="h-2" />
            </div>
            <Button type="button" variant="outline" size="sm" className="w-fit border-neutral-200">
              Open storage diagnostics
            </Button>
          </CardContent>
        </Card>
        <Card className="border-neutral-200 shadow-none">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Database className="size-4 text-blue-600" />
              PostgreSQL
            </CardTitle>
            <CardDescription>Metadata and audit · 24 connections active</CardDescription>
          </CardHeader>
          <CardContent className="text-sm text-neutral-600">
            <p>Database size: 1.8 GB</p>
            <p className="mt-1">Migration version: 002_atomic_permissions</p>
          </CardContent>
        </Card>
      </div>

      <DonutPlaceholder
        title="Quota distribution"
        segments={[
          { label: "Under 50%", percent: 55, color: "#22c55e" },
          { label: "50–90%", percent: 30, color: "#eab308" },
          { label: "Over 90%", percent: 15, color: "#ef4444" },
        ]}
      />
    </div>
  );
}

/** Human: Security policies, sessions, and rate limits wireframe. */
export function AdminWireframeSecurityTab() {
  return (
    <div className="flex flex-col gap-6">
      <WireframePageHeader
        title="Security"
        description="Sessions, authentication policy, and threat monitoring."
      />

      <Alert>
        <Lock className="size-4" />
        <AlertDescription>
          Wireframe only — configure enforced policies in Settings → Security after backend hooks ship.
        </AlertDescription>
      </Alert>

      <SettingsSection title="Authentication" description="Sign-in requirements for all users">
        <SettingsRow label="Require email verification" description="New accounts must verify email before access">
          <Switch defaultChecked />
        </SettingsRow>
        <SettingsRow label="Session lifetime" description="Idle timeout before re-authentication">
          <Input className="max-w-[120px] border-neutral-200 text-right" defaultValue="7" readOnly />
          <span className="ml-2 text-sm text-neutral-500">days</span>
        </SettingsRow>
        <SettingsRow label="Max concurrent sessions" description="Per user across devices">
          <Input className="max-w-[80px] border-neutral-200 text-right" defaultValue="5" readOnly />
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title="Rate limiting" description="Protect login and API endpoints">
        <SettingsRow label="Login attempts per IP" description="Per 15 minute window">
          <Input className="max-w-[80px] border-neutral-200 text-right" defaultValue="10" readOnly />
        </SettingsRow>
        <SettingsRow label="API burst limit" description="Authenticated requests per second">
          <Input className="max-w-[80px] border-neutral-200 text-right" defaultValue="50" readOnly />
        </SettingsRow>
      </SettingsSection>

      <Card className="border-neutral-200 shadow-none">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <KeyRound className="size-4" />
            Active sessions
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="flex flex-col gap-2 text-sm">
            <li className="flex justify-between rounded-md border border-neutral-100 px-3 py-2">
              <span>admin@example.com · Chrome · 192.168.1.4</span>
              <Button type="button" variant="ghost" size="sm" className="text-rose-600">
                Revoke
              </Button>
            </li>
            <li className="flex justify-between rounded-md border border-neutral-100 px-3 py-2">
              <span>jane@corp.com · Mobile Safari</span>
              <Button type="button" variant="ghost" size="sm" className="text-rose-600">
                Revoke
              </Button>
            </li>
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
