// Human: Overview tab — KPI grid, health summary, and quick actions for the admin wireframe.
// Agent: RENDERS mock metrics only; parent supplies dateRange state for segmented filters.

import { useState } from "react";
import { Activity, AlertTriangle, Download, RefreshCw, Shield, Users } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  BarChartPlaceholder,
  DonutPlaceholder,
  SegmentedFilter,
  StatCard,
  WireframePageHeader,
} from "@/components/admin/wireframe/wireframe-primitives";

const DATE_RANGES = [
  { id: "today", label: "Today" },
  { id: "7d", label: "7 days" },
  { id: "30d", label: "30 days" },
  { id: "90d", label: "90 days" },
  { id: "custom", label: "Custom" },
];

const METRIC_GROUPS = [
  { id: "all", label: "All metrics" },
  { id: "users", label: "Users" },
  { id: "storage", label: "Storage" },
  { id: "files", label: "Files" },
  { id: "security", label: "Security" },
];

/** Human: Dashboard home with stat cards and chart placeholders. */
export function AdminWireframeOverviewTab() {
  const [dateRange, setDateRange] = useState("30d");
  const [metricGroup, setMetricGroup] = useState("all");

  return (
    <div className="flex flex-col gap-6">
      <WireframePageHeader
        title="Overview"
        description="Instance health, usage trends, and alerts at a glance."
        actions={
          <>
            <SegmentedFilter
              options={DATE_RANGES}
              active={dateRange}
              onSelect={setDateRange}
              ariaLabel="Date range"
            />
            <Button type="button" variant="outline" size="sm" className="border-neutral-200">
              <RefreshCw data-icon="inline-start" className="size-3.5" />
              Refresh
            </Button>
            <Button type="button" variant="outline" size="sm" className="border-neutral-200">
              <Download data-icon="inline-start" className="size-3.5" />
              Export report
            </Button>
          </>
        }
      />

      <Alert className="border-amber-200 bg-amber-50 text-amber-900">
        <AlertTriangle className="size-4" />
        <AlertDescription>
          3 accounts pending approval · Nebular OS compression job running · Last backup 18h ago
        </AlertDescription>
      </Alert>

      <SegmentedFilter
        options={METRIC_GROUPS}
        active={metricGroup}
        onSelect={setMetricGroup}
        ariaLabel="Metric category"
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Total users" value="128" hint="12 active in last 24h" trend="up" trendLabel="+4.2%" />
        <StatCard label="Storage used" value="2.4 TB" hint="68% of allocated pool" trend="up" trendLabel="+12%" />
        <StatCard label="Files" value="84,291" hint="1,204 uploaded this period" trend="up" trendLabel="+8%" />
        <StatCard label="API requests" value="1.2M" hint="p99 latency 142ms" trend="down" trendLabel="-3%" />
        <StatCard label="Shares active" value="342" hint="18 public links" trend="up" trendLabel="+6" />
        <StatCard label="Failed logins" value="47" hint="Rate limited: 12" trend="down" trendLabel="-22%" />
        <StatCard label="Audit events" value="9,804" hint="Last 30 days" trend="up" trendLabel="+1.1k" />
        <StatCard label="Quota warnings" value="9" hint="Users above 90% usage" trend="flat" />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <BarChartPlaceholder
          title="Upload volume"
          subtitle={`By day · ${dateRange} · ${metricGroup}`}
          bars={[
            { label: "Mon", value: 42 },
            { label: "Tue", value: 58 },
            { label: "Wed", value: 35 },
            { label: "Thu", value: 71 },
            { label: "Fri", value: 64 },
            { label: "Sat", value: 28 },
            { label: "Sun", value: 19 },
          ]}
        />
        <BarChartPlaceholder
          title="Active users"
          subtitle="Daily unique sign-ins"
          bars={[
            { label: "W1", value: 88, color: "#2563eb" },
            { label: "W2", value: 92 },
            { label: "W3", value: 76 },
            { label: "W4", value: 105 },
          ]}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <DonutPlaceholder
          title="Storage by type"
          segments={[
            { label: "Images", percent: 34, color: "#2563eb" },
            { label: "Video", percent: 28, color: "#60a5fa" },
            { label: "Documents", percent: 22, color: "#93c5fd" },
            { label: "Other", percent: 16, color: "#e5e7eb" },
          ]}
        />
        <Card className="border-neutral-200 shadow-none lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Service health</CardTitle>
            <CardDescription>API, database, and object storage</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-3">
            {[
              { name: "API", status: "Healthy", latency: "24ms avg" },
              { name: "PostgreSQL", status: "Healthy", latency: "3ms avg" },
              { name: "Nebular OS", status: "Healthy", latency: "41ms avg" },
            ].map((svc) => (
              <div
                key={svc.name}
                className="flex flex-col gap-1 rounded-lg border border-neutral-200 bg-neutral-50/50 p-3"
              >
                <div className="flex items-center gap-2 text-sm font-medium text-neutral-900">
                  <Activity className="size-4 text-emerald-600" aria-hidden />
                  {svc.name}
                </div>
                <span className="text-xs text-emerald-700">{svc.status}</span>
                <span className="text-xs text-neutral-500">{svc.latency}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card className="border-neutral-200 shadow-none">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Users className="size-4 text-blue-600" />
              Quick actions
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            <Button type="button" variant="outline" className="justify-start border-neutral-200">
              Approve pending users
            </Button>
            <Button type="button" variant="outline" className="justify-start border-neutral-200">
              Invite administrator
            </Button>
            <Button type="button" variant="outline" className="justify-start border-neutral-200">
              Run storage audit
            </Button>
          </CardContent>
        </Card>
        <Card className="border-neutral-200 shadow-none sm:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Shield className="size-4 text-blue-600" />
              Recent security events
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col gap-2 text-sm text-neutral-700">
              <li className="flex justify-between gap-2 border-b border-neutral-100 pb-2">
                <span>Permission grant · group editors → folder Marketing</span>
                <span className="shrink-0 text-xs text-neutral-400">2m ago</span>
              </li>
              <li className="flex justify-between gap-2 border-b border-neutral-100 pb-2">
                <span>Failed login · user@example.com (rate limited)</span>
                <span className="shrink-0 text-xs text-neutral-400">14m ago</span>
              </li>
              <li className="flex justify-between gap-2">
                <span>Settings updated · max upload size</span>
                <span className="shrink-0 text-xs text-neutral-400">1h ago</span>
              </li>
            </ul>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
