import { IsOptional, IsNumber, IsEnum } from 'class-validator';
import { GradeLetter } from '@prisma/client';

export class UpdateGradeDto {
  @IsOptional()
  @IsEnum(GradeLetter)
  gradeLetter?: GradeLetter;

  @IsOptional()
  @IsNumber()
  gradePoint?: number;

  @IsOptional()
  @IsNumber()
  gradeNumber?: number;
}
