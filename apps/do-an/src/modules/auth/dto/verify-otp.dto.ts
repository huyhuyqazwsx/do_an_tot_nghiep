import { IsEmail, IsString, Length, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class SendOtpDto {
  @ApiProperty({ example: 'sinhvien@hust.edu.vn' })
  @IsEmail()
  email: string;
}

export class VerifyOtpDto {
  @ApiProperty({ example: 'sinhvien@hust.edu.vn' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: '123456' })
  @IsString()
  @Length(6, 6)
  otp: string;
}

export class ResetPasswordDto {
  @ApiProperty({ description: 'Reset token nhận được sau khi verify OTP' })
  @IsString()
  resetToken: string;

  @ApiProperty({ description: 'Mật khẩu mới' })
  @IsString()
  @MinLength(1)
  newPassword: string;
}
