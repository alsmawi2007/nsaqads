import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class OrgMemberGuard implements CanActivate {
  constructor(private prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const user = request.user;
    const orgId = request.params?.orgId;

    if (!orgId) return true;

    const membership = await this.prisma.membership.findUnique({
      where: { orgId_userId: { orgId, userId: user.sub } },
    });

    if (!membership) {
      throw new ForbiddenException('You are not a member of this organization');
    }

    const org = await this.prisma.organization.findUnique({ where: { id: orgId } });
    if (!org || !org.isActive) throw new NotFoundException('Organization not found');

    // Attach role to request for RolesGuard downstream
    request.memberRole = membership.role;
    request.orgId = orgId;

    return true;
  }
}
