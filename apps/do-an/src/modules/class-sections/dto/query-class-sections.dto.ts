import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { ClassSectionStatus, ClassSectionType } from '@prisma/client';

export const CLASS_SECTION_SORT_FIELDS = [
  'sectionCode',
  'semester',
  'registeredCount',
  'maxCapacity',
  'createdAt',
] as const;
export const SORT_DIRECTIONS = ['asc', 'desc'] as const;

export class QueryClassSectionsDto {
  @ApiPropertyOptional({ type: Number, example: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ type: Number, example: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000)
  limit?: number;

  @ApiPropertyOptional({
    type: String,
    description: 'Search by section code, course code, course name, or room',
  })
  @IsOptional()
  @IsString()
  q?: string;

  @ApiPropertyOptional({ example: '20221' })
  @IsOptional()
  @IsString()
  semester?: string;

  @ApiPropertyOptional({ example: '152001' })
  @IsOptional()
  @IsString()
  sectionCode?: string;

  @ApiPropertyOptional({ example: 'IT001' })
  @IsOptional()
  @IsString()
  courseCode?: string;

  @ApiPropertyOptional({ enum: ClassSectionType })
  @IsOptional()
  @IsEnum(ClassSectionType)
  sectionType?: ClassSectionType;

  @ApiPropertyOptional({ enum: ClassSectionStatus })
  @IsOptional()
  @IsEnum(ClassSectionStatus)
  sectionStatus?: ClassSectionStatus;

  @ApiPropertyOptional({ enum: CLASS_SECTION_SORT_FIELDS })
  @IsOptional()
  @IsIn(CLASS_SECTION_SORT_FIELDS)
  sortBy?: (typeof CLASS_SECTION_SORT_FIELDS)[number];

  @ApiPropertyOptional({ enum: SORT_DIRECTIONS })
  @IsOptional()
  @IsIn(SORT_DIRECTIONS)
  sortOrder?: (typeof SORT_DIRECTIONS)[number];
}
