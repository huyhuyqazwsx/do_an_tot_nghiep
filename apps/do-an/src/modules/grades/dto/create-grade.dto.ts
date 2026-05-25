import {
  IsString,
  IsUUID,
  IsOptional,
  IsNumber,
  IsEnum,
} from 'class-validator';
import { GradeLetter } from '@prisma/client';

export class CreateGradeDto {
  @IsUUID()
  userId: string;

  @IsUUID()
  courseId: string;

  @IsString()
  semester: string;

  @IsEnum(GradeLetter)
  gradeLetter: GradeLetter;

  @IsOptional()
  @IsNumber()
  gradePoint?: number;

  @IsOptional()
  @IsNumber()
  gradeNumber?: number;
}
