import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import {
  ExtractJwt,
  Strategy,
  StrategyOptionsWithoutRequest,
} from 'passport-jwt';
import type { Request } from 'express';
import {
  REDIS_CLIENT,
  type JwtPayload,
} from '@app/shared';
import { UserRole } from '@prisma/client';
import type Redis from 'ioredis';
import { RegistrationSlotsService } from '../registration-slots/registration-slots.service';
import { SettingsService } from '../settings/settings.service';

interface ExtractJwtType {
  fromAuthHeaderAsBearerToken: () => (req: Request) => string | null;
}

const JwtPassportStrategy = PassportStrategy(Strategy) as unknown as new (
  ...args: unknown[]
) => InstanceType<ReturnType<typeof PassportStrategy>>;

@Injectable()
export class JwtStrategy extends JwtPassportStrategy {
  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly settingsService: SettingsService,
    private readonly registrationSlotsService: RegistrationSlotsService,
  ) {
    const jwtSecret = process.env.JWT_SECRET;
    if (!jwtSecret) {
      throw new Error('JWT_SECRET is not defined');
    }

    const extractJwt = ExtractJwt as unknown as ExtractJwtType;
    const jwtFromRequest: (req: Request) => string | null =
      extractJwt.fromAuthHeaderAsBearerToken();

    super({
      jwtFromRequest,
      ignoreExpiration: false,
      secretOrKey: jwtSecret,
    } as StrategyOptionsWithoutRequest);
  }

  async validate(payload: JwtPayload) {
    if (!payload.sub || !payload.sessionId) {
      throw new UnauthorizedException();
    }

    const activeSessionId = await this.redis.get(`auth:session:${payload.sub}`);

    if (!activeSessionId || activeSessionId !== payload.sessionId) {
      throw new UnauthorizedException('Phiên đăng nhập không còn hiệu lực');
    }

    if (payload.role === UserRole.STUDENT) {
      const { currentSemester } = await this.settingsService.getAll();
      try {
        await this.registrationSlotsService.assertStudentCanRegister(
          currentSemester,
          payload.studentCode,
        );
      } catch (error) {
        throw new UnauthorizedException(
          error instanceof Error ? error.message : 'Chưa đến khung giờ đăng ký',
        );
      }
    }

    return payload;
  }
}
