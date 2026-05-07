import { ApiProperty } from '@nestjs/swagger';

export class CourseImportResponseDto {
  @ApiProperty()
  fileName: string;

  @ApiProperty()
  totalRows: number;

  @ApiProperty()
  inserted: number;

  @ApiProperty()
  skippedExisting: number;
}
