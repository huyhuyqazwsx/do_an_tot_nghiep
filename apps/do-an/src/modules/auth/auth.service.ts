import { Inject, Injectable, BadRequestException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService, type JwtPayload, REDIS_CLIENT } from '@app/shared';
import { UserRole } from '@prisma/client';
import { randomBytes, randomUUID } from 'crypto';
import type Redis from 'ioredis';
import * as nodemailer from 'nodemailer';
import { hashPassword, verifyPassword } from '../../common/security/password-hash.util';
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
  ) { }

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

  // ─── OTP Forgot Password Flow ─────────────────────────────────────────────

  /**
   * Bước 1: Gửi OTP 6 số về email. TTL = 5 phút. Rate-limit đơn giản qua Redis.
   */
  async sendOtp(email: string) {
    const user = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true, email: true, name: true, isActive: true },
    });

    // Không tiết lộ email có tồn tại hay không
    if (!user || !user.isActive) {
      return { message: 'Nếu email tồn tại trong hệ thống, mã OTP đã được gửi.' };
    }

    // Rate-limit: chỉ cho gửi lại sau 60 giây
    const rateLimitKey = `otp:ratelimit:${user.id}`;
    const isRateLimited = await this.redis.exists(rateLimitKey);
    if (isRateLimited) {
      throw new BadRequestException('Vui lòng đợi ít nhất 60 giây trước khi gửi lại OTP.');
    }

    // Sinh OTP 6 số
    const otp = String(Math.floor(100000 + Math.random() * 900000));
    const otpKey = `otp:${user.id}`;

    await this.redis.set(otpKey, otp, 'EX', 300); // TTL 5 phút
    await this.redis.set(rateLimitKey, '1', 'EX', 60); // Rate-limit 60s

    await this.sendOtpMail(user.email, user.name, otp);

    return { message: 'Nếu email tồn tại trong hệ thống, mã OTP đã được gửi.' };
  }

  /**
   * Bước 2: Verify OTP. Nếu đúng trả về resetToken (dùng 1 lần, TTL 10 phút).
   */
  async verifyOtp(email: string, otp: string) {
    const user = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true, isActive: true },
    });

    if (!user || !user.isActive) {
      throw new BadRequestException('OTP không hợp lệ hoặc đã hết hạn.');
    }

    const otpKey = `otp:${user.id}`;
    const storedOtp = await this.redis.get(otpKey);

    if (!storedOtp || storedOtp !== otp) {
      throw new BadRequestException('OTP không hợp lệ hoặc đã hết hạn.');
    }

    // Xóa OTP sau khi verify thành công (dùng 1 lần)
    await this.redis.del(otpKey);

    // Tạo resetToken (dùng 1 lần, TTL 10 phút)
    const resetToken = randomBytes(32).toString('hex');
    const resetKey = `otp:reset:${resetToken}`;
    await this.redis.set(resetKey, user.id, 'EX', 600); // TTL 10 phút

    return { resetToken, message: 'Xác thực OTP thành công. Bạn có 10 phút để đặt mật khẩu mới.' };
  }

  /**
   * Bước 3: Đặt lại mật khẩu bằng resetToken.
   */
  async resetPasswordWithToken(resetToken: string, newPassword: string) {
    const resetKey = `otp:reset:${resetToken}`;
    const userId = await this.redis.get(resetKey);

    if (!userId) {
      throw new BadRequestException('Token đặt lại mật khẩu không hợp lệ hoặc đã hết hạn.');
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: { password: hashPassword(newPassword) },
    });

    // Xóa reset token và invalidate session
    await this.redis.del(resetKey);
    await this.redis.del(this.getSessionKey(userId));

    return { message: 'Đặt lại mật khẩu thành công. Vui lòng đăng nhập lại.' };
  }


  async changePassword(uid: string, currentPassword: string, newPassword: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: uid },
      select: { id: true, password: true },
    });
    if (!user) throw new UnauthorizedException();

    const isMatch = await verifyPassword(currentPassword, user.password);
    if (!isMatch) throw new UnauthorizedException('Mật khẩu hiện tại không đúng');

    await this.prisma.user.update({
      where: { id: uid },
      data: { password: hashPassword(newPassword) },
    });

    // Invalidate session để buộc đăng nhập lại
    await this.redis.del(this.getSessionKey(uid));

    return { message: 'Đổi mật khẩu thành công. Vui lòng đăng nhập lại.' };
  }

  private async sendOtpMail(email: string, name: string, otp: string) {
    const transporter = nodemailer.createTransport({
      host: process.env.MAIL_HOST ?? 'smtp.gmail.com',
      port: Number(process.env.MAIL_PORT ?? 587),
      secure: false,
      auth: {
        user: process.env.MAIL_USER,
        pass: process.env.MAIL_APP_PASSWORD,
      },
    });

    await transporter.sendMail({
      from: `"Hệ thống Đăng ký Tín chỉ" <${process.env.MAIL_USER}>`,
      to: email,
      subject: '[Đăng ký Học phần] Mã OTP xác thực của bạn',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 480px; margin: auto; padding: 24px; border: 1px solid #e5e7eb; border-radius: 8px;">
          <h2 style="color: #1d4ed8;">Xác thực mã OTP</h2>
          <p>Xin chào <strong>${name}</strong>,</p>
          <p>Bạn vừa yêu cầu đặt lại mật khẩu. Nhập mã OTP sau để tiếp tục:</p>
          <div style="background:#f3f4f6; padding:16px 20px; border-radius:8px; font-size:36px; font-weight:bold; letter-spacing:10px; text-align:center; color:#111827; margin: 16px 0;">
            ${otp}
          </div>
          <p style="color:#6b7280; font-size:13px;">Mã OTP có hiệu lực trong <strong>5 phút</strong>.</p>
          <p style="color:#6b7280; font-size:13px;">Nếu bạn không yêu cầu đặt lại mật khẩu, hãy bỏ qua email này.</p>
        </div>
      `,
    });
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
