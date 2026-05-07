import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import {
  ClassSectionStatus,
  ClassSectionType,
  ClassTimeOfDay,
  SectionOpenGroup,
} from '@prisma/client';

export class CreateClassSectionDto {
  @ApiProperty({ example: '152001' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  sectionCode: string;

  @ApiPropertyOptional({ example: '152002' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  linkedSectionCode?: string;

  @ApiProperty({ example: 'IT001' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  courseCode: string;

  @ApiProperty({ example: '20221' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(10)
  semester: string;

  @ApiPropertyOptional({ example: 2 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(2)
  dayOfWeek?: number;

  @ApiPropertyOptional({ enum: ClassTimeOfDay })
  @IsOptional()
  @IsEnum(ClassTimeOfDay)
  timeOfDay?: ClassTimeOfDay;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  startPeriod?: number;

  @ApiPropertyOptional({ example: 3 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  endPeriod?: number;

  @ApiPropertyOptional({ example: '0645-0910' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  timeRange?: string;

  @ApiPropertyOptional({ example: '25-32,34-42' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  weekRange?: string;

  @ApiPropertyOptional({ example: 'A1-101' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  room?: string;

  @ApiPropertyOptional({ enum: ClassSectionType })
  @IsOptional()
  @IsEnum(ClassSectionType)
  sectionType?: ClassSectionType;

  @ApiPropertyOptional({ enum: SectionOpenGroup })
  @IsOptional()
  @IsEnum(SectionOpenGroup)
  openingGroup?: SectionOpenGroup;

  @ApiPropertyOptional({ enum: ClassSectionStatus })
  @IsOptional()
  @IsEnum(ClassSectionStatus)
  sectionStatus?: ClassSectionStatus;

  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @IsBoolean()
  requiresLab?: boolean;

  @ApiPropertyOptional({ example: 'Ghi chú lớp học' })
  @IsOptional()
  @IsString()
  note?: string;

  @ApiPropertyOptional({ example: 80 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  maxCapacity?: number;

  @ApiPropertyOptional({ example: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  registeredCount?: number;
}
