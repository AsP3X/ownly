// Human: Analytics tab — deep-dive statistics, comparisons, and export options (wireframe).
// Agent: RENDERS interactive filter UI only; no backend aggregation.

import { useState } from "react";
import { Calendar, Download, LineChart, SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  BarChartPlaceholder,
  SegmentedFilter,
  StatCard,
  WireframePageHeader,
} from "@/components/admin/wireframe/wireframe-primitives";

const ANALYTICS_VIEWS = [
  { id: "usage", label: "Usage" },
  { id: "traffic", label: "Traffic" },
  { id: "files", label: "Files" },
  { id: "users", label: "Users" },
  { id: "security", label: "Security" },
  { id: "performance", label: "Performance" },
];

const GRANULARITY = [
  { id: "hour", label: "Hourly" },
  { id: "day", label: "Daily" },
  { id: "week", label: "Weekly" },
  { id: "month", label: "Monthly" },
];

/** Human: Extended analytics workspace with many statistical dimensions. */
export function AdminWireframeAnalyticsTab() {
  const [view, setView] = useState("usage");
  const [granularity, setGranularity] = useState("day");
  const [comparePrevious, setComparePrevious] = useState(true);

  return (
    <div className="flex flex-col gap-6">
      <WireframePageHeader
        title="Analytics"
        description="Explore trends, breakdowns, and comparisons across your instance."
        actions={
          <>
            <Button type="button" variant="outline" size="sm" className="border-neutral-200">
              <Calendar data-icon="inline-start" className="size-3.5" />
              May 1 – May 25, 2026
            </Button>
            <Button type="button" size="sm" className="bg-blue-600 text-white hover:bg-blue-700">
              <Download data-icon="inline-start" className="size-3.5" />
              Export CSV
            </Button>
          </>
        }
      />

      <Card className="border-neutral-200 shadow-none">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <SlidersHorizontal className="size-4 text-neutral-500" />
            Report builder
          </CardTitle>
          <CardDescription>Combine dimensions without leaving the dashboard</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <div className="flex flex-col gap-2">
            <Label className="text-xs text-neutral-500">Primary metric</Label>
            <Input defaultValue="Storage bytes written" className="border-neutral-200" readOnly />
          </div>
          <div className="flex flex-col gap-2">
            <Label className="text-xs text-neutral-500">Group by</Label>
            <Input defaultValue="MIME category" className="border-neutral-200" readOnly />
          </div>
          <div className="flex flex-col gap-2">
            <Label className="text-xs text-neutral-500">Filter</Label>
            <Input defaultValue="Role = user" className="border-neutral-200" readOnly />
          </div>
          <div className="flex items-end">
            <Button type="button" className="w-full bg-blue-600 hover:bg-blue-700">
              Apply
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <SegmentedFilter options={ANALYTICS_VIEWS} active={view} onSelect={setView} ariaLabel="Analytics view" />
        <SegmentedFilter
          options={GRANULARITY}
          active={granularity}
          onSelect={setGranularity}
          ariaLabel="Time granularity"
        />
      </div>

      <div className="flex items-center justify-between gap-4 rounded-lg border border-neutral-200 bg-neutral-50/80 px-4 py-3">
        <div className="flex flex-col gap-0.5">
          <span className="text-sm font-medium text-neutral-900">Compare to previous period</span>
          <span className="text-xs text-neutral-500">Show % change on all charts</span>
        </div>
        <Switch checked={comparePrevious} onCheckedChange={setComparePrevious} />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard label="Bandwidth in" value="840 GB" trend="up" trendLabel="+18%" />
        <StatCard label="Bandwidth out" value="1.2 TB" trend="up" trendLabel="+9%" />
        <StatCard label="Avg file size" value="4.8 MB" trend="down" trendLabel="-2%" />
        <StatCard label="Downloads" value="42,100" trend="up" trendLabel="+14%" />
        <StatCard label="Unique uploaders" value="67" trend="up" trendLabel="+5" />
        <StatCard label="Error rate" value="0.04%" trend="down" trendLabel="-0.01%" />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <BarChartPlaceholder
          title={`${view} · ${granularity} trend`}
          subtitle={comparePrevious ? "Solid = current · faded = previous period" : "Current period only"}
          bars={[
            { label: "1", value: 40 },
            { label: "5", value: 55 },
            { label: "10", value: 48 },
            { label: "15", value: 72 },
            { label: "20", value: 65 },
            { label: "25", value: 80 },
          ]}
        />
        <Card className="border-neutral-200 shadow-none">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <LineChart className="size-4 text-blue-600" />
              Heatmap · activity by hour
            </CardTitle>
            <CardDescription>Uploads and API calls combined</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-12 gap-0.5" aria-hidden>
              {Array.from({ length: 84 }, (_, i) => (
                <div
                  key={i}
                  className="aspect-square rounded-sm"
                  style={{
                    backgroundColor: `oklch(0.55 0.12 250 / ${0.15 + (i % 7) * 0.1})`,
                  }}
                />
              ))}
            </div>
            <p className="mt-3 text-xs text-neutral-400">Heatmap placeholder</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <BarChartPlaceholder
          title="Top users by storage"
          subtitle="Top 10 · bar chart"
          bars={[
            { label: "A", value: 95 },
            { label: "B", value: 82 },
            { label: "C", value: 70 },
            { label: "D", value: 58 },
            { label: "E", value: 45 },
          ]}
        />
        <BarChartPlaceholder
          title="MIME distribution"
          subtitle="Share of total bytes"
          bars={[
            { label: "Img", value: 60 },
            { label: "Vid", value: 90 },
            { label: "Doc", value: 45 },
            { label: "Aud", value: 20 },
            { label: "Oth", value: 15 },
          ]}
        />
      </div>

      <Card className="border-neutral-200 shadow-none">
        <CardHeader>
          <CardTitle className="text-base">Saved reports</CardTitle>
          <CardDescription>Pin frequently used statistical views</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {[
            "Monthly storage growth",
            "Login failures by country",
            "Share link traffic",
            "Quota forecast",
            "Compression savings",
          ].map((name) => (
            <Button key={name} type="button" variant="outline" size="sm" className="border-neutral-200">
              {name}
            </Button>
          ))}
          <Button type="button" variant="ghost" size="sm" className="text-blue-700">
            + New report
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
