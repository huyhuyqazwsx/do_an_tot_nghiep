import { IsNotEmpty, IsString } from 'class-validator';

export class LoginDto {
  /** Student code đăng nhập (admin mặc định: 999999999) */
  @IsString()
  @IsNotEmpty()
  studentCode: string;

  /** Mật khẩu */
  @IsString()
  @IsNotEmpty()
  password: string;
}
