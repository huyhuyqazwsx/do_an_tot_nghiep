import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { CurrentUser, JwtAuthGuard } from '@app/shared';
import type { JwtPayload } from '@app/shared';
import { AuthUserResponseDto } from './dto/response/auth-user-response.dto';
import { LoginResponseDto } from './dto/response/login-response.dto';
import { LogoutResponseDto } from './dto/response/logout-response.dto';

@ApiTags('Auth')
@Controller('api/auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  @ApiOperation({ summary: 'Đăng nhập' })
  @ApiOkResponse({ type: LoginResponseDto })
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto.studentCode, dto.password);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Lấy thông tin sinh viên đang đăng nhập' })
  @ApiBearerAuth('access-token')
  @ApiOkResponse({ type: AuthUserResponseDto })
  getMe(@CurrentUser() user: JwtPayload) {
    return this.authService.getMe(user.sub);
  }

  @Post('logout')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Đăng xuất' })
  @ApiBearerAuth('access-token')
  @ApiOkResponse({ type: LogoutResponseDto })
  logout(@CurrentUser() user: JwtPayload) {
    return this.authService.logout(user.sub);
  }
}
