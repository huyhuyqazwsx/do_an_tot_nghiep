import { UserRole } from '@prisma/client';

export interface JwtPayload {
  sub: string;
  studentCode: string;
  role: UserRole;
  sessionId: string;
}
