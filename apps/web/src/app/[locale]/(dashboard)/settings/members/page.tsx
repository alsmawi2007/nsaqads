'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { PageContainer } from '@/components/layout/page-container';
import { FullPageSpinner } from '@/components/ui/spinner';
import { ErrorState } from '@/components/ui/error-state';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { useAuthStore, type MemberRole } from '@/lib/stores/auth.store';
import { orgMembersApi, type OrgMemberRow } from '@/lib/api/org-members';
import { InviteMemberForm } from '@/features/members/invite-member-form';

export default function MembersPage() {
  const t = useTranslations('members');
  const { user, activeOrg } = useAuthStore();
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [createdToast, setCreatedToast] = useState<{ email: string; createdNewUser: boolean } | null>(null);

  const orgId = activeOrg?.id;
  const myRole = activeOrg?.role;
  const canManage    = myRole === 'OWNER' || myRole === 'ADMIN';
  const canChangeRole = myRole === 'OWNER';

  const { data: members, isLoading, isError, refetch } = useQuery({
    queryKey: ['members', orgId],
    queryFn:  () => orgMembersApi.list(orgId!),
    enabled:  !!orgId,
  });

  const invite = useMutation({
    mutationFn: (payload: Parameters<typeof orgMembersApi.invite>[1]) =>
      orgMembersApi.invite(orgId!, payload),
    onSuccess: (res, vars) => {
      qc.invalidateQueries({ queryKey: ['members', orgId] });
      setAdding(false);
      setInviteError(null);
      setCreatedToast({ email: vars.email, createdNewUser: res.createdNewUser });
      setTimeout(() => setCreatedToast(null), 6000);
    },
    onError: (err: { message?: string }) => {
      setInviteError(err.message ?? 'invite_failed');
    },
  });

  const updateRole = useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: MemberRole }) =>
      orgMembersApi.updateRole(orgId!, userId, role),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['members', orgId] }),
  });

  const remove = useMutation({
    mutationFn: (userId: string) => orgMembersApi.remove(orgId!, userId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['members', orgId] }),
  });

  if (!user || !activeOrg) return <FullPageSpinner />;
  if (isLoading) return <FullPageSpinner />;
  if (isError)   return <ErrorState onRetry={() => refetch()} />;

  return (
    <PageContainer className="max-w-4xl gap-6">
      <header>
        <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-100">{t('title')}</h1>
        <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
          {t('subtitle', { org: activeOrg.name })}
        </p>
      </header>

      {/* Success toast */}
      {createdToast && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs text-emerald-800 dark:border-emerald-700/40 dark:bg-emerald-900/20 dark:text-emerald-300">
          {createdToast.createdNewUser
            ? t('toast.createdNew', { email: createdToast.email })
            : t('toast.added', { email: createdToast.email })}
        </div>
      )}

      {/* Invite form (admin only) */}
      {canManage && adding && (
        <InviteMemberForm
          assignableRoles={canChangeRole ? ['ADMIN', 'MEMBER', 'VIEWER'] : ['MEMBER', 'VIEWER']}
          onSubmit={(p) => {
            setInviteError(null);
            invite.mutate(p);
          }}
          onCancel={() => {
            setAdding(false);
            setInviteError(null);
          }}
          isSaving={invite.isPending}
          errorMessage={inviteError}
        />
      )}

      {canManage && !adding && (
        <div className="flex justify-end">
          <Button variant="primary" size="sm" onClick={() => setAdding(true)}>
            {t('addMember')}
          </Button>
        </div>
      )}

      {/* Members table */}
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800">
        <table className="min-w-full divide-y divide-slate-200 dark:divide-slate-700">
          <thead className="bg-slate-50 dark:bg-slate-900/40">
            <tr>
              <Th>{t('table.user')}</Th>
              <Th>{t('table.role')}</Th>
              <Th>{t('table.joined')}</Th>
              <Th className="text-end">{t('table.actions')}</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-700/60">
            {(members ?? []).map((m) => (
              <MemberRow
                key={m.id}
                row={m}
                isSelf={m.userId === user.sub}
                canManage={canManage}
                canChangeRole={canChangeRole}
                onRoleChange={(role) => updateRole.mutate({ userId: m.userId, role })}
                onRemove={() => {
                  if (confirm(t('confirmRemove', { email: m.user.email }))) {
                    remove.mutate(m.userId);
                  }
                }}
                disabled={updateRole.isPending || remove.isPending}
              />
            ))}
          </tbody>
        </table>
      </div>
    </PageContainer>
  );
}

function Th({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <th
      scope="col"
      className={`px-4 py-3 text-start text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 ${className ?? ''}`}
    >
      {children}
    </th>
  );
}

interface MemberRowProps {
  row:            OrgMemberRow;
  isSelf:         boolean;
  canManage:      boolean;
  canChangeRole:  boolean;
  onRoleChange:   (role: MemberRole) => void;
  onRemove:       () => void;
  disabled:       boolean;
}

function MemberRow({
  row, isSelf, canManage, canChangeRole, onRoleChange, onRemove, disabled,
}: MemberRowProps) {
  const t = useTranslations('members');
  const isOwner = row.role === 'OWNER';

  return (
    <tr className="text-sm">
      <td className="px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-100 text-xs font-semibold text-brand-700 dark:bg-brand-900/30 dark:text-brand-400">
            {(row.user.name ?? row.user.email).charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0">
            <p className="truncate font-medium text-slate-900 dark:text-slate-100">
              {row.user.name ?? row.user.email}
              {isSelf && <span className="ms-2 text-xs font-normal text-slate-500">{t('table.you')}</span>}
            </p>
            <p className="truncate text-xs text-slate-500 dark:text-slate-400">{row.user.email}</p>
          </div>
        </div>
      </td>
      <td className="px-4 py-3">
        {canChangeRole && !isOwner && !isSelf ? (
          <Select
            id={`role-${row.userId}`}
            value={row.role}
            onChange={(e) => onRoleChange(e.target.value as MemberRole)}
            disabled={disabled}
            className="h-8 max-w-[160px] text-xs"
          >
            <option value="ADMIN">{t('invite.roles.ADMIN')}</option>
            <option value="MEMBER">{t('invite.roles.MEMBER')}</option>
            <option value="VIEWER">{t('invite.roles.VIEWER')}</option>
          </Select>
        ) : (
          <RoleBadge role={row.role} />
        )}
      </td>
      <td className="px-4 py-3 text-xs text-slate-500 dark:text-slate-400">
        {row.joinedAt ? new Date(row.joinedAt).toLocaleDateString() : '—'}
      </td>
      <td className="px-4 py-3 text-end">
        {canManage && !isOwner && !isSelf && (
          <Button variant="ghost" size="sm" onClick={onRemove} disabled={disabled}>
            {t('table.remove')}
          </Button>
        )}
      </td>
    </tr>
  );
}

function RoleBadge({ role }: { role: MemberRole }) {
  const t = useTranslations('members.invite.roles');
  const variant: 'default' | 'success' | 'info' | 'muted' =
    role === 'OWNER'  ? 'default' :
    role === 'ADMIN'  ? 'info' :
    role === 'MEMBER' ? 'success' : 'muted';
  return <Badge variant={variant}>{t(role)}</Badge>;
}
