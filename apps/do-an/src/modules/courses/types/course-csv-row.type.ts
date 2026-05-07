import { IsNotEmpty, IsString, Matches, ValidateIf } from 'class-validator';

export class CourseCsvRow {
  @IsString()
  @IsNotEmpty()
  code: string;

  @IsString()
  @IsNotEmpty()
  name: string;

  @ValidateIf((_object, value) => value !== '')
  @IsString()
  duration?: string;

  @IsString()
  @IsNotEmpty()
  @Matches(/^\d+(\.\d+)?$/, {
    message: 'credits must be a number string',
  })
  credits: string;

  @ValidateIf((_object, value) => value !== '')
  @IsString()
  @Matches(/^\d+(\.\d+)?$/, {
    message: 'tuition_credits must be a number string',
  })
  tuition_credits?: string;

  @IsString()
  @IsNotEmpty()
  department: string;

  @ValidateIf((_object, value) => value !== '')
  @IsString()
  prerequisite?: string;

  @ValidateIf((_object, value) => value !== '')
  @IsString()
  english_name?: string;

  @ValidateIf((_object, value) => value !== '')
  @IsString()
  @Matches(/^\d+(\.\d+)?$/, { message: 'weight must be a number string' })
  weight?: string;
}
