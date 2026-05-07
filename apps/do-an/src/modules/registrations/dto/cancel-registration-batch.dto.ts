import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsUUID,
} from 'class-validator';

export class CancelRegistrationBatchDto {
  @ApiProperty({
    type: [String],
    example: ['uuid-class-section-1', 'uuid-class-section-2'],
    description: 'Danh sách ID lớp học phần cần hủy (1–10)',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(10)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  classSectionIds: string[];
}
