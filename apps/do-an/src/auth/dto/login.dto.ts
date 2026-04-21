import { IsNotEmpty, IsString } from 'class-validator';

export class LoginDto {
  /** Mã số sinh viên (VD: 20215678) */
  @IsString()
  @IsNotEmpty()
  studentId: string;

  /** Mật khẩu */
  @IsString()
  @IsNotEmpty()
  password: string;
}
