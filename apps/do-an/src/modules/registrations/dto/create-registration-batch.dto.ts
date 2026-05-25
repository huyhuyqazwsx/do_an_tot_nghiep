import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsString,
  Length,
} from 'class-validator';

export class CreateRegistrationBatchDto {
  @ApiProperty({ example: '20261', description: 'Mã học kỳ' })
  @IsString()
  @Length(1, 10)
  semester: string;

  @ApiProperty({
    type: [String],
    example: ['169995', '170001'],
    description: 'Danh sách mã lớp cần đăng ký (1–10 lớp)',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(10)
  @ArrayUnique()
  @IsString({ each: true })
  sectionCodes: string[];
}
