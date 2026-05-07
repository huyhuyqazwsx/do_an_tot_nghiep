import { ApiProperty } from '@nestjs/swagger';

export class ClassSectionDetailResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  sectionCode: string;
}
