import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Prisma } from '@prisma/client';
import { PrismaService, type JwtPayload, REDIS_CLIENT } from '@app/shared';
import * as bcrypt from 'bcrypt';
import { randomUUID } from 'crypto';
import type Redis from 'ioredis';
import { AuthUserRow, CurrentUserRow } from './types/auth-user-row.type';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  async login(userId: string, password: string) {
    const user = await this.findAuthUserByUserId(userId);

    if (!user) throw new UnauthorizedException('Tài khoản không tồn tại');
    if (!user.isActive) throw new UnauthorizedException('Tài khoản bị khóa');

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) throw new UnauthorizedException('Sai mật khẩu');

    const sessionId = randomUUID();
    const payload: JwtPayload = {
      sub: user.id,
      userId: user.userId,
      role: user.role,
      sessionId,
    };
    const sessionTtlSeconds = this.getSessionTtlSeconds();

    await this.redis.set(
      this.getSessionKey(user.id),
      sessionId,
      'EX',
      sessionTtlSeconds,
    );

    return {
      accessToken: this.jwtService.sign(payload),
      user: {
        id: user.id,
        userId: user.userId,
        name: user.name,
        email: user.email,
        role: user.role,
        program: user.program,
        courseYear: user.courseYear,
        department: user.department,
      },
    };
  }

  async getMe(uid: string) {
    const user = await this.findCurrentUserById(uid);
    if (!user) throw new UnauthorizedException();
    return user;
  }

  async logout(uid: string) {
    await this.redis.del(this.getSessionKey(uid));
    return { message: 'Đăng xuất thành công' };
  }

  private getSessionKey(uid: string) {
    return `auth:session:${uid}`;
  }

  private async findAuthUserByUserId(userId: string) {
    const users = await this.prisma.$queryRaw<AuthUserRow[]>(Prisma.sql`
      SELECT
        id,
        user_id AS "userId",
        name,
        email,
        password,
        role,
        program,
        course_year AS "courseYear",
        department,
        is_active AS "isActive"
      FROM users
      WHERE user_id = ${userId}
      LIMIT 1
    `);

    return users[0] ?? null;
  }

  private async findCurrentUserById(uid: string) {
    const users = await this.prisma.$queryRaw<CurrentUserRow[]>(Prisma.sql`
      SELECT
        id,
        user_id AS "userId",
        name,
        email,
        role,
        program,
        course_year AS "courseYear",
        department
      FROM users
      WHERE id = ${uid}::uuid
      LIMIT 1
    `);

    return users[0] ?? null;
  }

  private getSessionTtlSeconds() {
    const expiresIn = process.env.JWT_EXPIRES_IN ?? '1h';

    if (/^\d+$/.test(expiresIn)) {
      return Number(expiresIn);
    }

    const match = expiresIn.match(/^(\d+)([smhd])$/i);
    if (!match) {
      throw new Error(`JWT_EXPIRES_IN không hợp lệ: ${expiresIn}`);
    }

    const value = Number(match[1]);
    const unit = match[2].toLowerCase();

    switch (unit) {
      case 's':
        return value;
      case 'm':
        return value * 60;
      case 'h':
        return value * 60 * 60;
      case 'd':
        return value * 60 * 60 * 24;
      default:
        throw new Error(`JWT_EXPIRES_IN không hợp lệ: ${expiresIn}`);
    }
  }
}
