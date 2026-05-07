import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';

export class AuthUserResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  studentCode: string;

  @ApiProperty()
  name: string;

  @ApiProperty()
  email: string;

  @ApiProperty({ enum: UserRole })
  role: UserRole;

  @ApiPropertyOptional({ nullable: true })
  courseYear: number | null;

  @ApiPropertyOptional({ nullable: true })
  department: string | null;
}
