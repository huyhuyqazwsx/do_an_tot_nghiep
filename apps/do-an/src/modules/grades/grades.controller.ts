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
import { GradesService } from './grades.service';
import { CreateGradeDto } from './dto/create-grade.dto';
import { UpdateGradeDto } from './dto/update-grade.dto';

@ApiTags('Grades')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@Controller('api/grades')
export class GradesController {
  constructor(private readonly gradesService: GradesService) {}

  @Get()
  @ApiOperation({ summary: 'Get all grades with pagination' })
  findAll(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('q') q?: string,
    @Query('semester') semester?: string,
    @Query('userId') userId?: string,
  ) {
    return this.gradesService.findAll({
      page: page ? +page : undefined,
      limit: limit ? +limit : undefined,
      q,
      semester,
      userId,
    });
  }

  @Get('student/:studentCode')
  @ApiOperation({ summary: 'Get all grades of a student' })
  findByStudent(@Param('studentCode') studentCode: string) {
    return this.gradesService.findByStudent(studentCode);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get grade by id' })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.gradesService.findOne(id);
  }

  @Post()
  @ApiOperation({ summary: 'Create a grade record' })
  create(@Body() dto: CreateGradeDto) {
    return this.gradesService.create(dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a grade record' })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateGradeDto) {
    return this.gradesService.update(id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a grade record' })
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.gradesService.remove(id);
  }
}
