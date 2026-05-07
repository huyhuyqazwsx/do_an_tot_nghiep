import { ApiProperty } from '@nestjs/swagger';

export class ClassSectionListResponseDto {
  @ApiProperty({ type: [Object] })
  items: unknown[];

  @ApiProperty()
  meta: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}
