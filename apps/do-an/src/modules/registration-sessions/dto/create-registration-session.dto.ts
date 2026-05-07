import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsDateString,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class CreateRegistrationSessionDto {
  @ApiProperty({ example: '20221' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(10)
  semester: string;

  @ApiPropertyOptional({ example: 'Đăng ký học phần kỳ 20221' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  @ApiProperty({ example: '2026-05-07T01:00:00.000Z' })
  @IsDateString()
  openAt: string;

  @ApiProperty({ example: '2026-05-14T16:59:59.000Z' })
  @IsDateString()
  closeAt: string;

  @ApiPropertyOptional({ example: true, default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
