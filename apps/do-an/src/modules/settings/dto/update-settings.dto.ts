import { IsDateString, IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class UpdateSettingsDto {
  @IsOptional()
  @IsString()
  currentSemester?: string;

  @IsOptional()
  @IsString()
  semesterStartDate?: string;

  @IsOptional()
  @IsString()
  semesterEndDate?: string;

  @IsOptional()
  @IsDateString()
  registrationOpenAt?: string;

  @IsOptional()
  @IsDateString()
  registrationCloseAt?: string;

  @IsOptional()
  @IsNumber()
  @Min(1)
  maxCreditsPerSemester?: number;
}

export interface SystemSettings {
  currentSemester: string;
  semesterStartDate: string;
  semesterEndDate: string;
  registrationOpenAt: string;
  registrationCloseAt: string;
  maxCreditsPerSemester: number;
}
