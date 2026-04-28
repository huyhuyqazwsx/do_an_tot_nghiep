import { IsNotEmpty, IsString } from 'class-validator';

export class LoginDto {
  /** User ID đăng nhập (VD: mã sinh viên hoặc 999999999 cho admin) */
  @IsString()
  @IsNotEmpty()
  userId: string;

  /** Mật khẩu */
  @IsString()
  @IsNotEmpty()
  password: string;
}
