import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, MaxLength } from 'class-validator';

export class SendRegistrationCancelledTestDto {
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
}
