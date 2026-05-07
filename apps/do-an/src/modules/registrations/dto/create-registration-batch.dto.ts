import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsString,
  IsUUID,
  Length,
} from 'class-validator';

export class CreateRegistrationBatchDto {
  @ApiProperty({ example: '20261', description: 'Mã học kỳ' })
  @IsString()
  @Length(1, 10)
  semester: string;

  @ApiProperty({
    type: [String],
    example: ['uuid-class-section-1', 'uuid-class-section-2'],
    description: 'Danh sách ID lớp học phần cần đăng ký (1–10 lớp)',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(10)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  classSectionIds: string[];
}
