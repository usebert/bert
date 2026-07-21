import { useState } from "react";
import {
  BodyText,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  Checkbox,
  DataTable,
  Dialog,
  DialogBody,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  FormField,
  IconInbox,
  InlineLoading,
  Input,
  PageContainer,
  PageHeader,
  SearchInput,
  Section,
  Select,
  SkeletonCard,
  SkeletonLine,
  StatusBadge,
  TableBody,
  TableCell,
  TableContainer,
  TableHeadCell,
  TableHeader,
  TableRow,
  Textarea,
  Toolbar,
  Toggle,
  statusToBadgeVariant,
} from "../components/ui";

type Props = {
  onBack?: () => void;
};

const SAMPLE_STATUSES = ["Open", "Closed", "Overdue", "Due today", "Draft", "Approved", "Pending", "Synced", "Failed", "Offline"];

export function UiFoundationShowcase({ onBack }: Props) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [toggleOn, setToggleOn] = useState(true);
  const [loadingDemo, setLoadingDemo] = useState(false);

  return (
    <PageContainer>
      <PageHeader
        eyebrow="Development only"
        title="BERT UI Foundation"
        description="Release 1 design system — tokens, components, and layout primitives. Not visible to production users."
        primaryAction={
          onBack ? (
            <Button variant="secondary" onClick={onBack}>
              Back
            </Button>
          ) : undefined
        }
      />

      <div className="space-y-8">
        <Section title="Typography" description="Compact operational hierarchy for tablet-first layouts.">
          <Card>
            <CardContent className="space-y-2">
              <p className="text-xl font-semibold">Page title sample</p>
              <p className="text-lg font-semibold">Section title sample</p>
              <p className="text-base font-semibold">Card title sample</p>
              <BodyText>Body text — comfortable line height for operational copy.</BodyText>
              <p className="text-sm text-[var(--ui-text-secondary)]">Secondary body for supporting detail.</p>
              <p className="text-xs font-semibold uppercase tracking-wide text-[var(--ui-text-secondary)]">Label</p>
              <p className="text-xs text-[var(--ui-text-muted)]">Caption / metadata</p>
              <p className="text-3xl font-semibold">128</p>
            </CardContent>
          </Card>
        </Section>

        <Section title="Colour tokens" description="Semantic surfaces and status colours.">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[
              ["App background", "var(--ui-bg-app)"],
              ["Surface", "var(--ui-bg-surface)"],
              ["Muted surface", "var(--ui-bg-muted)"],
              ["Accent subtle", "var(--ui-accent-subtle)"],
            ].map(([label, color]) => (
              <div key={label} className="rounded-[var(--ui-radius-md)] border border-[var(--ui-border)] p-3">
                <div className="mb-2 h-10 rounded-[var(--ui-radius-sm)] border" style={{ background: color }} />
                <p className="text-xs font-semibold">{label}</p>
              </div>
            ))}
          </div>
        </Section>

        <Section title="Buttons">
          <Card>
            <CardContent className="flex flex-wrap gap-2">
              <Button variant="primary">Primary</Button>
              <Button variant="secondary">Secondary</Button>
              <Button variant="outline">Outline</Button>
              <Button variant="ghost">Ghost</Button>
              <Button variant="danger">Danger</Button>
              <Button variant="primary" size="lg">
                Large
              </Button>
              <Button
                variant="primary"
                loading={loadingDemo}
                onClick={() => {
                  setLoadingDemo(true);
                  window.setTimeout(() => setLoadingDemo(false), 1200);
                }}
              >
                Loading demo
              </Button>
            </CardContent>
          </Card>
        </Section>

        <Section title="Form controls">
          <Card>
            <CardContent className="grid gap-4 md:grid-cols-2">
              <FormField id="demo-name" label="Company name" required helperText="Minimum 44px touch height.">
                <Input id="demo-name" placeholder="Acme Ltd" />
              </FormField>
              <FormField id="demo-type" label="Type" error="Select a valid type.">
                <Select id="demo-type" defaultValue="">
                  <option value="">Select…</option>
                  <option value="construction">Construction</option>
                </Select>
              </FormField>
              <FormField id="demo-notes" label="Notes" className="md:col-span-2">
                <Textarea id="demo-notes" placeholder="Optional notes" />
              </FormField>
              <SearchInput placeholder="Search documents" aria-label="Search documents" />
              <Checkbox id="demo-check" label="Send welcome email" defaultChecked />
              <Toggle id="demo-toggle" label="Enable notifications" checked={toggleOn} onChange={setToggleOn} />
            </CardContent>
          </Card>
        </Section>

        <Section title="Status badges">
          <div className="flex flex-wrap gap-2">
            {SAMPLE_STATUSES.map((status) => (
              <StatusBadge key={status} variant={statusToBadgeVariant(status)}>
                {status}
              </StatusBadge>
            ))}
          </div>
        </Section>

        <Section title="Cards">
          <div className="grid gap-3 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Default card</CardTitle>
                <CardDescription>Subtle border and shadow.</CardDescription>
              </CardHeader>
              <CardContent>
                <SkeletonLine />
              </CardContent>
            </Card>
            <Card variant="interactive">
              <CardHeader>
                <CardTitle>Interactive card</CardTitle>
                <CardDescription>Hover/focus affordance.</CardDescription>
              </CardHeader>
              <CardFooter>
                <Button size="sm" variant="secondary">
                  Action
                </Button>
              </CardFooter>
            </Card>
          </div>
        </Section>

        <Section title="Table foundation">
          <TableContainer>
            <DataTable>
              <TableHeader>
                <TableRow>
                  <TableHeadCell>Item</TableHeadCell>
                  <TableHeadCell>Status</TableHeadCell>
                  <TableHeadCell>Owner</TableHeadCell>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow interactive>
                  <TableCell>Weekly site check</TableCell>
                  <TableCell>
                    <StatusBadge variant="warning">Due today</StatusBadge>
                  </TableCell>
                  <TableCell>Ada Admin</TableCell>
                </TableRow>
                <TableRow interactive>
                  <TableCell>Incident follow-up</TableCell>
                  <TableCell>
                    <StatusBadge variant="success">Closed</StatusBadge>
                  </TableCell>
                  <TableCell>Ben Auditor</TableCell>
                </TableRow>
              </TableBody>
            </DataTable>
          </TableContainer>
        </Section>

        <Section title="Loading & empty states">
          <div className="grid gap-3 md:grid-cols-2">
            <SkeletonCard />
            <EmptyState
              icon={<IconInbox size="lg" />}
              title="No records yet"
              description="When data loads, rows appear here. Use skeletons for page-level loading."
              primaryAction={{ label: "Create record", onClick: () => setDialogOpen(true) }}
            />
          </div>
          <InlineLoading label="Refreshing workspace…" />
        </Section>

        <Section title="Toolbar">
          <Toolbar>
            <SearchInput className="sm:max-w-xs" placeholder="Filter" aria-label="Filter" />
            <div className="flex flex-1 flex-wrap gap-2 sm:justify-end">
              <Button variant="outline" size="sm">
                Export
              </Button>
              <Button variant="primary" size="sm">
                Add
              </Button>
            </div>
          </Toolbar>
        </Section>

        <Section title="Dialog">
          <Button variant="primary" onClick={() => setDialogOpen(true)}>
            Open dialog
          </Button>
          <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} size="md">
            <DialogHeader>
              <DialogTitle>Foundation dialog</DialogTitle>
            </DialogHeader>
            <DialogBody>
              <p className="text-sm text-[var(--ui-text-secondary)]">
                Portal to document.body, viewport-safe shell, scrollable body, focus trap, and body scroll lock.
              </p>
            </DialogBody>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDialogOpen(false)}>
                Cancel
              </Button>
              <Button variant="primary" onClick={() => setDialogOpen(false)}>
                Confirm
              </Button>
            </DialogFooter>
          </Dialog>
        </Section>
      </div>
    </PageContainer>
  );
}
