import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard, Roles, RolesGuard } from '@app/shared';
import { UserRole } from '@prisma/client';
import { CreateRegistrationSessionDto } from './dto/create-registration-session.dto';
import { UpdateRegistrationSessionDto } from './dto/update-registration-session.dto';
import { RegistrationSessionsService } from './registration-sessions.service';

@ApiTags('Registration Sessions')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@Controller('api/registration-sessions')
export class RegistrationSessionsController {
  constructor(
    private readonly registrationSessionsService: RegistrationSessionsService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Admin list registration semester configs' })
  @ApiOkResponse()
  findAll() {
    return this.registrationSessionsService.findAll();
  }

  @Get(':semester')
  @ApiOperation({ summary: 'Admin get registration semester config' })
  @ApiOkResponse()
  findOne(@Param('semester') semester: string) {
    return this.registrationSessionsService.findOne(semester);
  }

  @Post()
  @ApiOperation({ summary: 'Admin create registration semester config' })
  @ApiCreatedResponse()
  create(@Body() dto: CreateRegistrationSessionDto) {
    return this.registrationSessionsService.create(dto);
  }

  @Patch(':semester')
  @ApiOperation({ summary: 'Admin update registration semester config' })
  @ApiOkResponse()
  update(
    @Param('semester') semester: string,
    @Body() dto: UpdateRegistrationSessionDto,
  ) {
    return this.registrationSessionsService.update(semester, dto);
  }

  @Delete(':semester')
  @ApiOperation({ summary: 'Admin delete registration semester config' })
  @ApiOkResponse()
  remove(@Param('semester') semester: string) {
    return this.registrationSessionsService.remove(semester);
  }
}
