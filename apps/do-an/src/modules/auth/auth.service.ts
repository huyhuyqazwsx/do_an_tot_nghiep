import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService, type JwtPayload, REDIS_CLIENT } from '@app/shared';
import { UserRole } from '@prisma/client';
import { randomUUID } from 'crypto';
import type Redis from 'ioredis';
import { verifyPassword } from '../../common/security/password-hash.util';
import { RegistrationSlotsService } from '../registration-slots/registration-slots.service';
import { SettingsService } from '../settings/settings.service';

// TODO: Xóa constant này sau khi đã seed tài khoản admin thật vào DB
const SUPERADMIN_BYPASS_ID = '00000000-0000-0000-0000-000000000001';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly settingsService: SettingsService,
    private readonly registrationSlotsService: RegistrationSlotsService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  async login(studentCode: string, password: string) {
    // TODO: Xóa bypass này sau khi đã seed tài khoản admin thật vào DB
    if (studentCode === '999999999' && password === 'admin') {
      const sessionId = randomUUID();
      const payload: JwtPayload = {
        sub: SUPERADMIN_BYPASS_ID,
        studentCode: '999999999',
        role: UserRole.ADMIN,
        sessionId,
      };
      const sessionTtlSeconds = this.getSessionTtlSeconds();
      await this.redis.set(
        this.getSessionKey(SUPERADMIN_BYPASS_ID),
        sessionId,
        'EX',
        sessionTtlSeconds,
      );
      return {
        accessToken: this.jwtService.sign(payload),
        user: {
          id: SUPERADMIN_BYPASS_ID,
          studentCode: '999999999',
          name: 'Super Admin',
          email: 'admin@system.local',
          role: 'ADMIN',
          courseYear: null,
          department: null,
        },
      };
    }

    const user = await this.findAuthUserByStudentCode(studentCode);

    if (!user) throw new UnauthorizedException('Tài khoản không tồn tại');
    if (!user.isActive) throw new UnauthorizedException('Tài khoản bị khóa');

    const isMatch = await verifyPassword(password, user.password);
    if (!isMatch) throw new UnauthorizedException('Sai mật khẩu');

    if (user.role === UserRole.STUDENT) {
      const { currentSemester } = await this.settingsService.getAll();
      try {
        await this.registrationSlotsService.assertStudentCanRegister(
          currentSemester,
          user.studentCode,
        );
      } catch (error) {
        throw new UnauthorizedException(
          error instanceof Error ? error.message : 'Chưa đến khung giờ đăng ký',
        );
      }
    }

    const sessionId = randomUUID();
    const payload: JwtPayload = {
      sub: user.id,
      studentCode: user.studentCode,
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
        studentCode: user.studentCode,
        name: user.name,
        email: user.email,
        role: user.role,
        courseYear: user.courseYear,
        department: user.department,
      },
    };
  }

  async getMe(uid: string) {
    // TODO: Xóa bypass này sau khi đã seed tài khoản admin thật vào DB
    if (uid === SUPERADMIN_BYPASS_ID) {
      return {
        id: SUPERADMIN_BYPASS_ID,
        studentCode: '999999999',
        name: 'Super Admin',
        email: 'admin@system.local',
        role: 'ADMIN',
        courseYear: null,
        department: null,
      };
    }

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

  private async findAuthUserByStudentCode(studentCode: string) {
    return this.prisma.user.findUnique({
      where: { studentCode },
      select: {
        id: true,
        studentCode: true,
        name: true,
        email: true,
        password: true,
        role: true,
        courseYear: true,
        department: true,
        isActive: true,
      },
    });
  }

  private async findCurrentUserById(uid: string) {
    return this.prisma.user.findUnique({
      where: { id: uid },
      select: {
        id: true,
        studentCode: true,
        name: true,
        email: true,
        role: true,
        courseYear: true,
        department: true,
      },
    });
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
