import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CourseResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  code: string;

  @ApiProperty()
  name: string;

  @ApiPropertyOptional({ nullable: true })
  englishName: string | null;

  @ApiProperty()
  credits: number;

  @ApiPropertyOptional({ nullable: true })
  tuitionCredits: string | null;

  @ApiPropertyOptional({ nullable: true })
  courseLoad: string | null;

  @ApiPropertyOptional({ nullable: true })
  department: string | null;

  @ApiPropertyOptional({ nullable: true })
  prerequisite: string | null;

  @ApiProperty()
  weight: string;
}
