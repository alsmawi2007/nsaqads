'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Toggle } from '@/components/ui/toggle';
import type { MemberRole } from '@/lib/stores/auth.store';
import type { InviteMemberPayload } from '@/lib/api/org-members';

interface InviteMemberFormProps {
  // OWNER is intentionally excluded — promotion to OWNER goes through a
  // dedicated transfer-ownership flow, not invite.
  assignableRoles: Array<Exclude<MemberRole, 'OWNER'>>;
  onSubmit:        (payload: InviteMemberPayload) => void;
  onCancel:        () => void;
  isSaving:        boolean;
  errorMessage:    string | null;
}

export function InviteMemberForm({
  assignableRoles, onSubmit, onCancel, isSaving, errorMessage,
}: InviteMemberFormProps) {
  const t = useTranslations('members.invite');
  const [email,        setEmail]        = useState('');
  const [name,         setName]         = useState('');
  const [role,         setRole]         = useState<Exclude<MemberRole, 'OWNER'>>('MEMBER');
  const [setPassword,  setSetPassword]  = useState(true);
  const [password,     setPassword2]    = useState('');

  const emailInvalid    = !email.trim() || !/.+@.+\..+/.test(email);
  const passwordInvalid = setPassword && password.length < 8;
  const disabled        = emailInvalid || passwordInvalid;

  function handleSubmit() {
    if (disabled) return;
    onSubmit({
      email: email.trim(),
      role,
      ...(name.trim() ? { name: name.trim() } : {}),
      ...(setPassword ? { password } : {}),
    });
  }

  return (
    <div className="flex flex-col gap-4 rounded-xl border border-slate-200 bg-slate-50 p-5 dark:border-slate-700 dark:bg-slate-900/40">
      <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">{t('title')}</h3>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <Input
          id="invite-email"
          label={t('email')}
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="user@example.com"
        />
        <Input
          id="invite-name"
          label={t('name')}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t('namePlaceholder')}
        />
      </div>

      <Select
        id="invite-role"
        label={t('role')}
        value={role}
        onChange={(e) => setRole(e.target.value as Exclude<MemberRole, 'OWNER'>)}
      >
        {assignableRoles.map((r) => (
          <option key={r} value={r}>{t(`roles.${r}`)}</option>
        ))}
      </Select>
      <p className="-mt-2 text-xs text-slate-500 dark:text-slate-400">{t(`roleHint.${role}`)}</p>

      <div className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-800">
        <Toggle
          checked={setPassword}
          onChange={setSetPassword}
          label={t('setPasswordToggle')}
          description={t('setPasswordHint')}
        />
        {setPassword && (
          <Input
            id="invite-password"
            label={t('password')}
            type="password"
            value={password}
            onChange={(e) => setPassword2(e.target.value)}
            placeholder={t('passwordPlaceholder')}
            error={passwordInvalid && password.length > 0 ? t('passwordTooShort') : undefined}
            autoComplete="new-password"
          />
        )}
      </div>

      {errorMessage && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-900/30 dark:text-red-300">
          {errorMessage}
        </p>
      )}

      <div className="flex justify-end gap-2 pt-1">
        <Button variant="ghost" size="sm" onClick={onCancel} disabled={isSaving}>
          {t('cancel')}
        </Button>
        <Button
          variant="primary"
          size="sm"
          onClick={handleSubmit}
          loading={isSaving}
          disabled={disabled}
        >
          {t('submit')}
        </Button>
      </div>
    </div>
  );
}
