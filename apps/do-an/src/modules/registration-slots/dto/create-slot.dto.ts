import {
  IsString,
  IsOptional,
  IsNotEmpty,
  Matches,
  MaxLength,
} from 'class-validator';

export class CreateSlotDto {
  @IsString()
  semester: string;

  @IsOptional()
  @IsString()
  name?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  studentCodeFrom: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  studentCodeTo: string;

  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  startDate: string;

  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  endDate: string;

  @IsString()
  @Matches(/^\d{2}:\d{2}$/)
  startTime: string;

  @IsString()
  @Matches(/^\d{2}:\d{2}$/)
  endTime: string;
}
