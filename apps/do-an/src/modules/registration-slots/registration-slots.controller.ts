import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  CurrentUser,
  JwtAuthGuard,
  Roles,
  RolesGuard,
  type JwtPayload,
} from '@app/shared';
import { UserRole } from '@prisma/client';
import { RegistrationSlotsService } from './registration-slots.service';
import { CreateSlotDto } from './dto/create-slot.dto';
import { UpdateSlotDto } from './dto/update-slot.dto';

@ApiTags('Registration Slots')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@Controller('api/registration-slots')
export class RegistrationSlotsController {
  constructor(private readonly slotsService: RegistrationSlotsService) {}

  @Get('current/me')
  @ApiOperation({ summary: 'Get current registration window for current user' })
  findCurrentForMe(
    @Query('semester') semester: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.slotsService.getCurrentRegistrationWindowForStudent(
      semester,
      user.studentCode,
    );
  }

  @Get()
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Get all registration slots' })
  findAll(@Query('semester') semester?: string) {
    return this.slotsService.findAll(semester);
  }

  @Get(':id')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Get slot by id' })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.slotsService.findOne(id);
  }

  @Post()
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Create a registration slot' })
  create(@Body() dto: CreateSlotDto) {
    return this.slotsService.create(dto);
  }

  @Patch(':id')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Update a registration slot' })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateSlotDto) {
    return this.slotsService.update(id, dto);
  }

  @Delete(':id')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Delete a registration slot' })
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.slotsService.remove(id);
  }
}
