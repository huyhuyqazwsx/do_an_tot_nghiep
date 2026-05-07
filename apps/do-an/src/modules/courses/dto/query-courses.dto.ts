import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export const COURSE_SORT_FIELDS = [
  'code',
  'name',
  'credits',
  'department',
  'weight',
] as const;
export const SORT_DIRECTIONS = ['asc', 'desc'] as const;

export class QueryCoursesDto {
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
  @Max(100)
  limit?: number;

  @ApiPropertyOptional({
    type: String,
    description: 'Search by course code, name, English name, or department',
  })
  @IsOptional()
  @IsString()
  q?: string;

  @ApiPropertyOptional({ type: String, description: 'Filter by department' })
  @IsOptional()
  @IsString()
  department?: string;

  @ApiPropertyOptional({ type: Number, example: 3 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  credits?: number;

  @ApiPropertyOptional({ type: Number, example: 2 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  minCredits?: number;

  @ApiPropertyOptional({ type: Number, example: 5 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  maxCredits?: number;

  @ApiPropertyOptional({ enum: COURSE_SORT_FIELDS })
  @IsOptional()
  @IsIn(COURSE_SORT_FIELDS)
  sortBy?: (typeof COURSE_SORT_FIELDS)[number];

  @ApiPropertyOptional({ enum: SORT_DIRECTIONS })
  @IsOptional()
  @IsIn(SORT_DIRECTIONS)
  sortOrder?: (typeof SORT_DIRECTIONS)[number];
}
