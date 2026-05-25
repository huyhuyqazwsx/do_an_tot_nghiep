import { IsString, IsOptional, IsObject, IsDateString } from 'class-validator';

export class UpdateSlotDto {
  @IsOptional()
  @IsString()
  semester?: string;

  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsObject()
  studentFilter?: Record<string, unknown>;

  @IsOptional()
  @IsDateString()
  openAt?: string;

  @IsOptional()
  @IsDateString()
  closeAt?: string;

  @IsOptional()
  @IsDateString()
  prewarmAt?: string;
}
