import { ApiProperty } from '@nestjs/swagger';

export class ClassSectionImportResponseDto {
  @ApiProperty()
  fileName: string;

  @ApiProperty()
  totalRows: number;

  @ApiProperty()
  inserted: number;

  @ApiProperty()
  skippedDuplicateRows: number;

  @ApiProperty()
  skippedExisting: number;
}
