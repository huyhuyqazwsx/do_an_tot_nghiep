import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { CurrentUser, JwtAuthGuard, RolesGuard } from '@app/shared';
import { Roles } from '@app/shared';
import type { JwtPayload } from '@app/shared';
import { RegistrationsService } from './registrations.service';
import { CreateRegistrationBatchDto } from './dto/create-registration-batch.dto';
import { CancelRegistrationBatchDto } from './dto/cancel-registration-batch.dto';

@ApiTags('Registrations')
@Controller('api/registrations')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth('access-token')
export class RegistrationsController {
  constructor(private readonly registrationsService: RegistrationsService) {}

  // ─── Student endpoints ─────────────────────────────────────────────────────

  @Get('my')
  @ApiOperation({
    summary: 'Lấy danh sách đăng ký của sinh viên đang đăng nhập',
  })
  @ApiQuery({ name: 'semester', required: true, example: '20261' })
  getMyRegistrations(
    @CurrentUser() user: JwtPayload,
    @Query('semester') semester: string,
  ) {
    return this.registrationsService.getMyRegistrations(user, semester);
  }

  @Post('batches')
  @ApiOperation({ summary: 'Tạo batch đăng ký nhiều lớp học phần' })
  createBatch(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateRegistrationBatchDto,
  ) {
    return this.registrationsService.createBatch(user, dto);
  }

  @Delete('batches')
  @ApiOperation({ summary: 'Tạo batch hủy đăng ký (không xóa, gửi vào queue)' })
  cancelBatch(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CancelRegistrationBatchDto,
  ) {
    return this.registrationsService.cancelBatch(user, dto);
  }

  @Get('batches/:batchId')
  @ApiOperation({ summary: 'Lấy chi tiết kết quả batch (để FE polling)' })
  getBatch(
    @CurrentUser() user: JwtPayload,
    @Param('batchId', ParseUUIDPipe) batchId: string,
  ) {
    return this.registrationsService.findBatchById(batchId, user.sub);
  }

  // ─── Admin endpoints ───────────────────────────────────────────────────────

  @Get()
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({
    summary: '[Admin] Lấy danh sách đăng ký theo kỳ / sinh viên',
  })
  @ApiQuery({ name: 'semester', required: true, example: '20261' })
  @ApiQuery({ name: 'studentCode', required: false, example: '20215678' })
  adminGetRegistrations(
    @Query('semester') semester: string,
    @Query('studentCode') studentCode?: string,
  ) {
    return this.registrationsService.adminGetRegistrations(
      semester,
      studentCode,
    );
  }
}
