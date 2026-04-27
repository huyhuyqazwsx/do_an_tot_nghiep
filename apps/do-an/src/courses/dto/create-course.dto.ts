import {
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateCourseDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  code: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(300)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  englishName?: string;

  @IsNumber()
  @Min(0)
  credits: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  tuitionCredits?: number;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  courseLoad?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  department?: string;

  @IsOptional()
  @IsString()
  prerequisite?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  weight?: number;
}
