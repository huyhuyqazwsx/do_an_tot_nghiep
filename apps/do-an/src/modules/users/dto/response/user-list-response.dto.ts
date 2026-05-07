import { ApiProperty } from '@nestjs/swagger';
import { PaginationMetaResponseDto } from '../../../courses/dto/response/pagination-meta-response.dto';
import { UserResponseDto } from './user-response.dto';

export class UserListResponseDto {
  @ApiProperty({ type: [UserResponseDto] })
  items: UserResponseDto[];

  @ApiProperty({ type: PaginationMetaResponseDto })
  meta: PaginationMetaResponseDto;
}
