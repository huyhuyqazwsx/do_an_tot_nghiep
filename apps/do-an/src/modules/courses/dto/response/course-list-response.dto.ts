import { ApiProperty } from '@nestjs/swagger';
import { CourseResponseDto } from './course-response.dto';
import { PaginationMetaResponseDto } from './pagination-meta-response.dto';

export class CourseListResponseDto {
  @ApiProperty({ type: [CourseResponseDto] })
  items: CourseResponseDto[];

  @ApiProperty({ type: PaginationMetaResponseDto })
  meta: PaginationMetaResponseDto;
}
