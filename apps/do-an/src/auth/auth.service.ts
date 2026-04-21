import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '@app/shared';
import * as bcrypt from 'bcrypt';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
  ) {}

  async login(studentId: string, password: string) {
    const student = await this.prisma.student.findUnique({
      where: { studentId },
    });

    if (!student) throw new UnauthorizedException('Tài khoản không tồn tại');
    if (!student.isActive) throw new UnauthorizedException('Tài khoản bị khóa');

    const isMatch = await bcrypt.compare(password, student.password);
    if (!isMatch) throw new UnauthorizedException('Sai mật khẩu');

    const payload = {
      sub: student.id,
      studentId: student.studentId,
      role: 'student',
    };

    return {
      accessToken: this.jwtService.sign(payload),
      student: {
        id: student.id,
        studentId: student.studentId,
        name: student.name,
        email: student.email,
        program: student.program,
        courseYear: student.courseYear,
        department: student.department,
      },
    };
  }

  async getMe(uid: string) {
    const student = await this.prisma.student.findUnique({
      where: { id: uid },
      select: {
        id: true,
        studentId: true,
        name: true,
        email: true,
        program: true,
        courseYear: true,
        department: true,
      },
    });
    if (!student) throw new UnauthorizedException();
    return student;
  }
}
