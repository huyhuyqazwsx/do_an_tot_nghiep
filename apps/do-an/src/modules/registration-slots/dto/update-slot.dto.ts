import { IsString, IsOptional, MaxLength } from 'class-validator';

export class UpdateSlotDto {
  @IsOptional()
  @IsString()
  semester?: string;

  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  studentCodeFrom?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  studentCodeTo?: string;

  @IsOptional()
  @IsString()
  startDate?: string;

  @IsOptional()
  @IsString()
  endDate?: string;

  @IsOptional()
  @IsString()
  startTime?: string;

  @IsOptional()
  @IsString()
  endTime?: string;
}
