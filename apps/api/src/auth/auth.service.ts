import {
  Injectable,
  ConflictException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
    private config: ConfigService,
  ) {}

  async register(dto: RegisterDto) {
    const existing = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (existing) throw new ConflictException('Email already registered');

    const passwordHash = await bcrypt.hash(dto.password, 12);
    const user = await this.prisma.user.create({
      data: { email: dto.email, passwordHash, name: dto.name },
      select: { id: true, email: true, name: true, createdAt: true },
    });

    return user;
  }

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (!user || !user.isActive) throw new UnauthorizedException('Invalid credentials');

    const valid = await bcrypt.compare(dto.password, user.passwordHash);
    if (!valid) throw new UnauthorizedException('Invalid credentials');

    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    const memberships = await this.prisma.membership.findMany({
      where: { userId: user.id },
      select: {
        role: true,
        org: { select: { id: true, name: true, slug: true } },
      },
    });

    const tokens = await this.generateTokenPair(user.id, user.email, user.isSystemAdmin);

    return {
      ...tokens,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        preferredLang: user.preferredLang,
      },
      orgs: memberships.map((m) => ({
        id: m.org.id,
        name: m.org.name,
        slug: m.org.slug,
        role: m.role,
      })),
    };
  }

  async refresh(userId: string, tokenId: string, rawRefreshToken: string) {
    const tokenHash = crypto.createHash('sha256').update(rawRefreshToken).digest('hex');
    const stored = await this.prisma.refreshToken.findUnique({ where: { tokenHash } });

    if (!stored || stored.userId !== userId || stored.revoked || stored.expiresAt < new Date()) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    // Rotate: revoke old token, issue new pair
    await this.prisma.refreshToken.update({ where: { id: stored.id }, data: { revoked: true } });

    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { id: true, email: true, isSystemAdmin: true },
    });

    return this.generateTokenPair(user.id, user.email, user.isSystemAdmin);
  }

  async logout(rawRefreshToken: string): Promise<void> {
    const tokenHash = crypto.createHash('sha256').update(rawRefreshToken).digest('hex');
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash },
      data: { revoked: true },
    });
  }

  private async generateTokenPair(userId: string, email: string, isSystemAdmin: boolean) {
    const accessToken = this.jwt.sign(
      { sub: userId, email, isSystemAdmin },
      {
        secret: this.config.get<string>('jwt.secret'),
        expiresIn: this.config.get<string>('jwt.expiresIn'),
      },
    );

    const tokenId = crypto.randomUUID();
    const rawRefreshToken = crypto.randomBytes(64).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawRefreshToken).digest('hex');
    const refreshExpiresIn = this.config.get<string>('jwt.refreshExpiresIn') || '7d';
    const expiresAt = new Date(Date.now() + this.parseDuration(refreshExpiresIn));

    const refreshToken = this.jwt.sign(
      { sub: userId, tokenId },
      { secret: this.config.get<string>('jwt.refreshSecret'), expiresIn: refreshExpiresIn },
    );

    await this.prisma.refreshToken.create({
      data: { userId, tokenHash, expiresAt },
    });

    return { accessToken, refreshToken };
  }

  private parseDuration(duration: string): number {
    const unit = duration.slice(-1);
    const value = parseInt(duration.slice(0, -1), 10);
    const ms = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };
    return value * (ms[unit as keyof typeof ms] || 86_400_000);
  }
}
