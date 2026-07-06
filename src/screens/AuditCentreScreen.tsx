import type { Role } from "../permissions";
import {
  canAccessGoogleForms,
  canAccessResults,
  canAccessFormsChecksNav,
  canAccessWorkspaceNav,
  usesAssignedChecksCompletionFlow,
} from "../permissions";
import type { NavItemId } from "../types/navigation";
import { getRoleTheme } from "../config/roleTheme";
import { SectionIntro } from "../components/SectionIntro";
import { AnimatedButton } from "../components/animation/AnimatedButton";
import { bertSectionEnter } from "../components/animation/animationClasses";

type AuditCentreCard = {
  id: string;
  title: string;
  description: string;
  actionLabel: string;
  screen: NavItemId;
};

type Props = {
  role: Role;
  onNavigate: (screen: NavItemId) => void;
};

function buildCards(role: Role): AuditCentreCard[] {
  const cards: AuditCentreCard[] = [];

  if (canAccessWorkspaceNav(role)) {
    cards.push({
      id: "build",
      title: "Build audits/checks",
      description: "Create reusable audit templates with the Audit Builder and publish checks your team can schedule.",
      actionLabel: "Open Audit Builder",
      screen: "auditBuilder",
    });
  }

  if (usesAssignedChecksCompletionFlow(role) || canAccessFormsChecksNav(role)) {
    cards.push({
      id: "assigned",
      title: "Complete assigned work",
      description: "Start or continue checks assigned to you from live schedules.",
      actionLabel: role === "Auditor" ? "Open My Checks" : "Open assigned work",
      screen: "audits",
    });
  }

  if (canAccessGoogleForms(role)) {
    cards.push({
      id: "forms",
      title: "Manage forms",
      description: "View live Google Forms in your company folder, sync them to BERT, and import forms as check templates.",
      actionLabel: "Open Google Forms",
      screen: "googleForms",
    });
  }

  if (canAccessResults(role)) {
    cards.push({
      id: "completed",
      title: "Completed work",
      description: "Review submitted check results and drill into answers, findings, and evidence references.",
      actionLabel: "Open results",
      screen: "results",
    });
  }

  return cards;
}

export function AuditCentreScreen({ role, onNavigate }: Props) {
  const theme = getRoleTheme(role);
  const cards = buildCards(role);

  return (
    <div className={["space-y-4", bertSectionEnter].join(" ")}>
      <section className="rounded-[1.75rem] border border-slate-200/90 bg-white p-5 shadow-sm">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Audit Centre</h1>
        <SectionIntro
          role={role}
          className="mt-2"
          text={
            role === "Auditor"
              ? "Complete assigned checks, then return here for other audit tasks when your role allows."
              : "Build checks, complete assigned work, manage Google Forms, and review completed submissions from one place."
          }
        />
      </section>

      {cards.length === 0 ? (
        <section className="rounded-2xl border border-slate-200 bg-slate-50 px-5 py-6 text-sm text-slate-600">
          No audit tasks are available for your role in this workspace.
        </section>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {cards.map((card) => (
            <article
              key={card.id}
              className="flex h-full flex-col rounded-[1.75rem] border border-slate-200 bg-white p-5 shadow-sm"
            >
              <h2 className="text-lg font-semibold text-slate-900">{card.title}</h2>
              <p className="mt-2 flex-1 text-sm leading-relaxed text-slate-600">{card.description}</p>
              <AnimatedButton
                type="button"
                showArrow
                onClick={() => onNavigate(card.screen)}
                className={[
                  "mt-4 inline-flex h-11 items-center rounded-xl px-4 text-sm font-semibold text-white",
                  theme.primaryButton,
                  theme.primaryButtonHover,
                ].join(" ")}
              >
                {card.actionLabel}
              </AnimatedButton>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
