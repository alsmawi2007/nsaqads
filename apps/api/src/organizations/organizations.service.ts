import {
  Injectable, NotFoundException, ConflictException, ForbiddenException,
} from '@nestjs/common';
import { MemberRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CreateOrgDto } from './dto/create-org.dto';
import { InviteMemberDto } from './dto/invite-member.dto';
import { UpdateMemberRoleDto } from './dto/update-member-role.dto';

@Injectable()
export class OrganizationsService {
  constructor(private prisma: PrismaService, private audit: AuditService) {}

  async create(userId: string, dto: CreateOrgDto) {
    const exists = await this.prisma.organization.findUnique({ where: { slug: dto.slug } });
    if (exists) throw new ConflictException('Organization slug already taken');

    const org = await this.prisma.organization.create({
      data: {
        name: dto.name,
        slug: dto.slug,
        logoUrl: dto.logoUrl,
        memberships: {
          create: { userId, role: MemberRole.OWNER, joinedAt: new Date() },
        },
      },
    });

    await this.audit.log({
      orgId: org.id, userId,
      action: 'organization.create',
      resourceType: 'Organization', resourceId: org.id,
      afterState: { name: org.name, slug: org.slug },
    });

    return org;
  }

  async findAllForUser(userId: string) {
    return this.prisma.organization.findMany({
      where: { isActive: true, memberships: { some: { userId } } },
      include: { memberships: { where: { userId }, select: { role: true } } },
    });
  }

  async findOne(id: string) {
    const org = await this.prisma.organization.findUnique({ where: { id } });
    if (!org || !org.isActive) throw new NotFoundException('Organization not found');
    return org;
  }

  async update(id: string, userId: string, data: Partial<{ name: string; logoUrl: string }>) {
    const org = await this.findOne(id);
    const updated = await this.prisma.organization.update({ where: { id }, data });
    await this.audit.log({
      orgId: id, userId,
      action: 'organization.update',
      resourceType: 'Organization', resourceId: id,
      beforeState: { name: org.name },
      afterState: { name: updated.name },
    });
    return updated;
  }

  async listMembers(orgId: string) {
    return this.prisma.membership.findMany({
      where: { orgId },
      include: { user: { select: { id: true, name: true, email: true, avatarUrl: true } } },
    });
  }

  async inviteMember(orgId: string, invitedById: string, dto: InviteMemberDto) {
    const user = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (!user) throw new NotFoundException('User with that email not found');

    const existing = await this.prisma.membership.findUnique({
      where: { orgId_userId: { orgId, userId: user.id } },
    });
    if (existing) throw new ConflictException('User is already a member');

    const membership = await this.prisma.membership.create({
      data: { orgId, userId: user.id, role: dto.role, invitedById, joinedAt: new Date() },
    });

    await this.audit.log({
      orgId, userId: invitedById,
      action: 'membership.invite',
      resourceType: 'Membership', resourceId: membership.id,
      afterState: { email: dto.email, role: dto.role },
    });

    return membership;
  }

  async updateMemberRole(orgId: string, targetUserId: string, requesterId: string, dto: UpdateMemberRoleDto) {
    const membership = await this.prisma.membership.findUnique({
      where: { orgId_userId: { orgId, userId: targetUserId } },
    });
    if (!membership) throw new NotFoundException('Member not found');
    if (membership.role === MemberRole.OWNER) throw new ForbiddenException('Cannot change owner role');

    const updated = await this.prisma.membership.update({
      where: { id: membership.id },
      data: { role: dto.role },
    });

    await this.audit.log({
      orgId, userId: requesterId,
      action: 'membership.role_change',
      resourceType: 'Membership', resourceId: membership.id,
      beforeState: { role: membership.role },
      afterState: { role: dto.role },
    });

    return updated;
  }

  async removeMember(orgId: string, targetUserId: string, requesterId: string) {
    const membership = await this.prisma.membership.findUnique({
      where: { orgId_userId: { orgId, userId: targetUserId } },
    });
    if (!membership) throw new NotFoundException('Member not found');
    if (membership.role === MemberRole.OWNER) throw new ForbiddenException('Cannot remove org owner');

    await this.prisma.membership.delete({ where: { id: membership.id } });

    await this.audit.log({
      orgId, userId: requesterId,
      action: 'membership.remove',
      resourceType: 'Membership', resourceId: membership.id,
      beforeState: { userId: targetUserId, role: membership.role },
    });
  }
}
