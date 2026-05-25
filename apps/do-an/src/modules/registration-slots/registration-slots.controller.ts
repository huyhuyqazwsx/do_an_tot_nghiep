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
import { JwtAuthGuard, Roles, RolesGuard } from '@app/shared';
import { UserRole } from '@prisma/client';
import { RegistrationSlotsService } from './registration-slots.service';
import { CreateSlotDto } from './dto/create-slot.dto';
import { UpdateSlotDto } from './dto/update-slot.dto';

@ApiTags('Registration Slots')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@Controller('api/registration-slots')
export class RegistrationSlotsController {
  constructor(private readonly slotsService: RegistrationSlotsService) {}

  @Get()
  @ApiOperation({ summary: 'Get all registration slots' })
  findAll(@Query('semester') semester?: string) {
    return this.slotsService.findAll(semester);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get slot by id' })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.slotsService.findOne(id);
  }

  @Post()
  @ApiOperation({ summary: 'Create a registration slot' })
  create(@Body() dto: CreateSlotDto) {
    return this.slotsService.create(dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a registration slot' })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateSlotDto) {
    return this.slotsService.update(id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a registration slot' })
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.slotsService.remove(id);
  }

  @Post(':id/prewarm')
  @ApiOperation({ summary: 'Trigger prewarm for a slot (load to Redis)' })
  triggerPrewarm(@Param('id', ParseUUIDPipe) id: string) {
    return this.slotsService.triggerPrewarm(id);
  }
}
