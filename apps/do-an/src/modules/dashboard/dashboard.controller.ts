import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
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
}
