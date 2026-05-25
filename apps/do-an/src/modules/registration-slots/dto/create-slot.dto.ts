import {
  IsString,
  IsOptional,
  IsObject,
  IsDateString,
} from 'class-validator';

export class CreateSlotDto {
  @IsString()
  semester: string;

  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsObject()
  studentFilter?: Record<string, unknown>;

  @IsDateString()
  openAt: string;

  @IsDateString()
  closeAt: string;

  @IsDateString()
  prewarmAt: string;
}
