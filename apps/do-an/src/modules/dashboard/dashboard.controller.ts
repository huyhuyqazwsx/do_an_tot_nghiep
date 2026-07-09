import {
  Controller,
  Get,
  Post,
  Query,
  Res,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiProduces,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import type { Response } from 'express';
import { JwtAuthGuard, RolesGuard, Roles } from '@app/shared';
import { DashboardService } from './dashboard.service';

@ApiTags('Dashboard')
@Controller('api/admin/dashboard')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@ApiBearerAuth('access-token')
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get('overview')
  @ApiOperation({
    summary: '[Admin] Tổng quan hệ thống cho dashboard',
  })
  @ApiQuery({ name: 'semester', required: true, example: '20252' })
  getOverview(@Query('semester') semester: string) {
    return this.dashboardService.getOverview(semester);
  }

  @Get('metrics/export')
  @ApiOperation({
    summary: '[Admin] Export metrics dashboard theo khoảng thời gian (CSV)',
  })
  @ApiProduces('text/csv')
  @ApiQuery({ name: 'semester', required: true, example: '20252' })
  @ApiQuery({
    name: 'from',
    required: true,
    example: '2026-06-01T00:00:00.000Z',
  })
  @ApiQuery({
    name: 'to',
    required: true,
    example: '2026-06-30T23:59:59.999Z',
  })
  async exportMetrics(
    @Query('semester') semester: string,
    @Query('from') from: string,
    @Query('to') to: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    const file = await this.dashboardService.exportMetricsCsv(
      semester,
      from,
      to,
    );

    response.setHeader('Content-Type', 'text/csv; charset=utf-8');
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="${file.filename}"`,
    );

    return new StreamableFile(Buffer.from(file.content, 'utf8'));
  }

  @Post('reset')
  @ApiOperation({
    summary: '[Admin] Reset toàn bộ dữ liệu test (truncate batches, reset sl_dk, xóa Redis RPS)',
  })
  resetTestData() {
    return this.dashboardService.resetTestData();
  }
}
