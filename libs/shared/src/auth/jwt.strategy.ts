import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import {
  ExtractJwt,
  Strategy,
  StrategyOptionsWithoutRequest,
} from 'passport-jwt';
import { Request } from 'express';
import { REDIS_CLIENT } from '../redis/redis.module';
import { UserRole } from '@prisma/client';

interface RedisClient {
  get(key: string): Promise<string | null>;
}

interface ExtractJwtType {
  fromAuthHeaderAsBearerToken: () => (req: Request) => string | null;
}

export interface JwtPayload {
  sub: string;
  studentCode: string;
  role: UserRole;
  sessionId: string;
}

const JwtPassportStrategy = PassportStrategy(Strategy) as unknown as new (
  ...args: unknown[]
) => InstanceType<ReturnType<typeof PassportStrategy>>;

@Injectable()
export class JwtStrategy extends JwtPassportStrategy {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: RedisClient) {
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

    return payload;
  }
}
