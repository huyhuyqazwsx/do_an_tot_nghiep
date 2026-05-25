import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard, Roles, RolesGuard } from '@app/shared';
import { UserRole } from '@prisma/client';
import { CreateRegistrationSessionDto } from './dto/create-registration-session.dto';
import { UpdateRegistrationSessionDto } from './dto/update-registration-session.dto';
import { RegistrationSessionsService } from './registration-sessions.service';

@ApiTags('Registration Sessions')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@Controller('api/registration-sessions')
export class RegistrationSessionsController {
  constructor(
    private readonly registrationSessionsService: RegistrationSessionsService,
  ) {}

  // ─── Student: phiên đăng ký hiện hành ─────────────────────────────────────
  // PHẢI đặt trước route ':semester' để NestJS không match "current" thành param

  @Get('current')
  @ApiOperation({ summary: 'Sinh viên lấy phiên đăng ký hiện hành' })
  @ApiQuery({ name: 'semester', required: true, example: '20252' })
  @ApiOkResponse()
  findCurrent(@Query('semester') semester: string) {
    return this.registrationSessionsService.findCurrent(semester);
  }

  // ─── Admin CRUD ────────────────────────────────────────────────────────────

  @Get()
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Admin list registration semester configs' })
  @ApiOkResponse()
  findAll() {
    return this.registrationSessionsService.findAll();
  }

  @Get(':semester')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Admin get registration semester config' })
  @ApiOkResponse()
  findOne(@Param('semester') semester: string) {
    return this.registrationSessionsService.findOne(semester);
  }

  @Get(':semester/stats')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Admin lấy thống kê phiên đăng ký (hardcoded)' })
  @ApiOkResponse()
  getStats(@Param('semester') semester: string) {
    return this.registrationSessionsService.getStats(semester);
  }

  @Post()
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Admin create registration semester config' })
  @ApiCreatedResponse()
  create(@Body() dto: CreateRegistrationSessionDto) {
    return this.registrationSessionsService.create(dto);
  }

  @Patch(':semester')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Admin update registration semester config' })
  @ApiOkResponse()
  update(
    @Param('semester') semester: string,
    @Body() dto: UpdateRegistrationSessionDto,
  ) {
    return this.registrationSessionsService.update(semester, dto);
  }

  @Delete(':semester')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Admin delete registration semester config' })
  @ApiOkResponse()
  remove(@Param('semester') semester: string) {
    return this.registrationSessionsService.remove(semester);
  }
}
