import { ApiProperty } from '@nestjs/swagger';
import { IsEmail } from 'class-validator';

export class ForgotPasswordDto {
  @ApiProperty({ example: 'sv123@example.com' })
  @IsEmail({}, { message: 'Email không hợp lệ' })
  email: string;
}
