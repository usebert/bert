import { useEffect, useRef, useState } from "react";
import type { Role } from "../../permissions";
import { getEditableCompanyMemberRoles } from "../../permissions";
import type { CompanyMember } from "../../services/companyUserService";
import { DangerActionButton } from "../DangerActionButton";
import { formatInviteStatusLabel, formatUserRoleLabel } from "../../utils/inviteStatusDisplay";

export type ActiveUserCardProps = {
  member: CompanyMember;
  currentUserRole: Role;
  currentUserEmail?: string;
  onEdit: (member: CompanyMember, input: { name: string; role: string }) => void | Promise<void>;
  onDeactivate: (member: CompanyMember) => void | Promise<void>;
  onRemove?: (member: CompanyMember) => void | Promise<void>;
  editing?: boolean;
  slatePrimaryCtaInteract: string;
};

function formatMemberStatus(status: string): string {
  const normalized = String(status || "ACTIVE").trim().toUpperCase();
  if (normalized === "ACTIVE") {
    return "Active";
  }
  if (normalized === "INACTIVE") {
    return "Inactive";
  }
  return formatInviteStatusLabel(status);
}

export function ActiveUserCard({
  member,
  currentUserRole,
  currentUserEmail,
  onEdit,
  onDeactivate,
  onRemove,
  editing = false,
  slatePrimaryCtaInteract,
}: ActiveUserCardProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [draftName, setDraftName] = useState(member.name);
  const [draftRole, setDraftRole] = useState(member.role);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const editableRoles = getEditableCompanyMemberRoles(currentUserRole);
  const canManage = editableRoles.length > 0;
  const isSelf = Boolean(currentUserEmail && member.email.toLowerCase() === currentUserEmail.toLowerCase());
  const areas =
    Array.isArray(member.companyAreas) && member.companyAreas.length > 0
      ? member.companyAreas.join(", ")
      : "All areas";

  useEffect(() => {
    setDraftName(member.name);
    setDraftRole(member.role);
  }, [member.email, member.name, member.role]);

  useEffect(() => {
    if (!menuOpen) {
      return;
    }
    const onPointerDown = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    };
    window.addEventListener("mousedown", onPointerDown);
    return () => window.removeEventListener("mousedown", onPointerDown);
  }, [menuOpen]);

  const saveEdit = async () => {
    const name = draftName.trim();
    if (!name) {
      return;
    }
    await onEdit(member, { name, role: draftRole });
    setEditOpen(false);
    setMenuOpen(false);
  };

  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-slate-900">{member.name || member.email}</p>
          <p className="mt-0.5 truncate text-xs text-slate-500">{member.email}</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="rounded-full border border-slate-200 bg-white px-2.5 py-0.5 text-xs font-semibold text-slate-700">
              {formatUserRoleLabel(member.role)}
            </span>
            <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-semibold text-emerald-800">
              {formatMemberStatus(member.status)}
            </span>
          </div>
          <p className="mt-2 text-xs text-slate-500">
            <span className="font-semibold text-slate-600">Areas:</span> {areas}
          </p>
        </div>
        {canManage ? (
          <div className="relative shrink-0" ref={menuRef}>
            <button
              type="button"
              aria-label="User actions"
              onClick={() => setMenuOpen((open) => !open)}
              className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-slate-300 bg-white text-lg font-semibold text-slate-700"
            >
              ⋯
            </button>
            {menuOpen ? (
              <div className="absolute right-0 z-20 mt-1 w-44 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-lg">
                <button
                  type="button"
                  onClick={() => {
                    setEditOpen(true);
                    setMenuOpen(false);
                  }}
                  className="block w-full px-3 py-2 text-left text-sm font-medium text-slate-800 hover:bg-slate-50"
                >
                  Edit user
                </button>
                {!isSelf ? (
                  <button
                    type="button"
                    onClick={async () => {
                      setMenuOpen(false);
                      await onDeactivate(member);
                    }}
                    className="block w-full px-3 py-2 text-left text-sm font-medium text-amber-900 hover:bg-amber-50"
                  >
                    Deactivate
                  </button>
                ) : null}
                {!isSelf && onRemove ? (
                  <DangerActionButton
                    type="button"
                    onClick={async () => {
                      setMenuOpen(false);
                      await onRemove(member);
                    }}
                    className="block w-full rounded-none border-0 px-3 py-2 text-left text-sm font-medium"
                  >
                    Remove user
                  </DangerActionButton>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      {editOpen ? (
        <div className="mt-3 rounded-xl border border-slate-200 bg-white p-3">
          <label className="block">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Display name</span>
            <input
              value={draftName}
              onChange={(event) => setDraftName(event.target.value)}
              className="mt-1 h-10 w-full rounded-xl border border-slate-200 px-3 text-sm text-slate-900"
            />
          </label>
          <label className="mt-3 block">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Role</span>
            <select
              value={draftRole}
              onChange={(event) => setDraftRole(event.target.value)}
              disabled={isSelf}
              className="mt-1 h-10 w-full rounded-xl border border-slate-200 px-3 text-sm text-slate-900 disabled:opacity-60"
            >
              {editableRoles.map((role) => (
                <option key={role} value={role}>
                  {formatUserRoleLabel(role)}
                </option>
              ))}
            </select>
          </label>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={editing || !draftName.trim()}
              onClick={() => void saveEdit()}
              className={`h-10 rounded-xl bg-slate-900 px-4 text-sm font-semibold text-white disabled:opacity-60 ${slatePrimaryCtaInteract}`}
            >
              {editing ? "Saving…" : "Save changes"}
            </button>
            <button
              type="button"
              onClick={() => setEditOpen(false)}
              className="h-10 rounded-xl border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
