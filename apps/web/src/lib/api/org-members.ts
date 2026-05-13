import { api } from './client';
import type { MemberRole } from '@/lib/stores/auth.store';

export interface OrgMemberRow {
  id:          string;
  orgId:       string;
  userId:      string;
  role:        MemberRole;
  invitedById: string | null;
  joinedAt:    string | null;
  createdAt:   string;
  user: {
    id:        string;
    name:      string | null;
    email:     string;
    avatarUrl: string | null;
  };
}

export interface InviteMemberPayload {
  email:    string;
  role:     MemberRole;
  // Required only when inviting an email that has no user yet — creates the
  // account with this password. Backend rejects with 404 otherwise.
  password?: string;
  name?:     string;
}

export interface InviteMemberResponse {
  membership:     OrgMemberRow;
  createdNewUser: boolean;
}

export const orgMembersApi = {
  list: (orgId: string): Promise<OrgMemberRow[]> =>
    api.get<OrgMemberRow[]>(`/orgs/${orgId}/members`),

  invite: (orgId: string, payload: InviteMemberPayload): Promise<InviteMemberResponse> =>
    api.post<InviteMemberResponse>(`/orgs/${orgId}/members/invite`, payload),

  updateRole: (orgId: string, userId: string, role: MemberRole): Promise<OrgMemberRow> =>
    api.patch<OrgMemberRow>(`/orgs/${orgId}/members/${userId}/role`, { role }),

  remove: (orgId: string, userId: string): Promise<void> =>
    api.delete<void>(`/orgs/${orgId}/members/${userId}`),
};
