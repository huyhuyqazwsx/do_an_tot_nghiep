import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

export class ChangePasswordDto {
  @ApiProperty()
  @IsString()
  currentPassword: string;

  @ApiProperty({ minLength: 1 })
  @IsString()
  @MinLength(1, { message: 'Mật khẩu mới không được để trống' })
  newPassword: string;
}
