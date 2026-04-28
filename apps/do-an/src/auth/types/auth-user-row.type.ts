import { UserRole } from '@prisma/client';

export type AuthUserRow = {
  id: string;
  userId: string;
  name: string;
  email: string;
  password: string;
  role: UserRole;
  program: string | null;
  courseYear: number | null;
  department: string | null;
  isActive: boolean;
};

export type CurrentUserRow = Omit<AuthUserRow, 'password' | 'isActive'>;
