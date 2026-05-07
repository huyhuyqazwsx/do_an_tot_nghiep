import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard, Roles, RolesGuard } from '@app/shared';
import { UserRole } from '@prisma/client';
import { CreateUserDto } from './dto/create-user.dto';
import { QueryUsersDto } from './dto/query-users.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UserImportResponseDto } from './dto/response/user-import-response.dto';
import { UserListResponseDto } from './dto/response/user-list-response.dto';
import { UserResponseDto } from './dto/response/user-response.dto';
import type { UploadedCsvFile } from './types/uploaded-csv-file.type';
import { UsersService } from './users.service';

@ApiTags('Users')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@Controller('api/users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  @ApiOperation({ summary: 'Admin get users with pagination and filters' })
  @ApiOkResponse({ type: UserListResponseDto })
  findAll(@Query() query: QueryUsersDto) {
    return this.usersService.findAll(query);
  }

  @Get(':studentCode')
  @ApiOperation({ summary: 'Admin get user by student code' })
  @ApiOkResponse({ type: UserResponseDto })
  findOne(@Param('studentCode') studentCode: string) {
    return this.usersService.findOne(studentCode);
  }

  @Post()
  @ApiOperation({ summary: 'Admin create user account' })
  @ApiCreatedResponse({ type: UserResponseDto })
  create(@Body() dto: CreateUserDto) {
    return this.usersService.create(dto);
  }

  @Patch(':studentCode')
  @ApiOperation({ summary: 'Admin update user account by student code' })
  @ApiOkResponse({ type: UserResponseDto })
  update(
    @Param('studentCode') studentCode: string,
    @Body() dto: UpdateUserDto,
  ) {
    return this.usersService.update(studentCode, dto);
  }

  @Delete(':studentCode')
  @ApiOperation({ summary: 'Admin delete user account by student code' })
  @ApiOkResponse({ type: UserResponseDto })
  remove(@Param('studentCode') studentCode: string) {
    return this.usersService.remove(studentCode);
  }

  @Post('import')
  @ApiOperation({ summary: 'Admin import user accounts from CSV file' })
  @ApiCreatedResponse({ type: UserImportResponseDto })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          format: 'binary',
          description:
            'CSV columns: studentCode,name,email,password,role,courseYear,department,isActive',
        },
      },
      required: ['file'],
    },
  })
  @UseInterceptors(FileInterceptor('file'))
  importUsers(@UploadedFile() file: UploadedCsvFile) {
    if (!file) {
      throw new BadRequestException('CSV file is required');
    }

    if (!file.originalname.toLowerCase().endsWith('.csv')) {
      throw new BadRequestException('Only .csv files are supported');
    }

    return this.usersService.importUsers(file);
  }
}
