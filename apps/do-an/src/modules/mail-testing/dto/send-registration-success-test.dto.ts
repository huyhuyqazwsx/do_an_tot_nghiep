import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

export class SendRegistrationSuccessTestDto {
  @ApiProperty({ example: 'student@example.com' })
  @IsEmail()
  to: string;

  @ApiProperty({ example: 'Nguyễn Văn A' })
  @IsString()
  @MaxLength(200)
  studentName: string;

  @ApiProperty({ example: '169995' })
  @IsString()
  @MaxLength(20)
  sectionCode: string;

  @ApiProperty({ example: 'Cơ sở dữ liệu' })
  @IsString()
  @MaxLength(300)
  courseName: string;

  @ApiProperty({ example: 'IT3090' })
  @IsString()
  @MaxLength(20)
  courseCode: string;

  @ApiProperty({ example: '20221' })
  @IsString()
  @MaxLength(10)
  semester: string;

  @ApiPropertyOptional({ example: 12 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  remainingSlots?: number;
}
