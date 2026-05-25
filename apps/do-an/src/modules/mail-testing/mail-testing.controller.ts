import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard, Roles, RolesGuard } from '@app/shared';
import { UserRole } from '@prisma/client';
import { SendRegistrationSuccessTestDto } from './dto/send-registration-success-test.dto';
import { SendRegistrationCancelledTestDto } from './dto/send-registration-cancelled-test.dto';
import { SendRegistrationFailedTestDto } from './dto/send-registration-failed-test.dto';
import { MailTestingService } from './mail-testing.service';

@ApiTags('Mail Testing')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@Controller('api/mail-test')
export class MailTestingController {
  constructor(private readonly mailTestingService: MailTestingService) {}

  @Post('registration-success')
  @ApiOperation({ summary: 'Send test registration success email' })
  @ApiOkResponse()
  sendRegistrationSuccess(@Body() dto: SendRegistrationSuccessTestDto) {
    return this.mailTestingService.sendRegistrationSuccess(dto);
  }

  @Post('registration-cancelled')
  @ApiOperation({ summary: 'Send test registration cancelled email' })
  @ApiOkResponse()
  sendRegistrationCancelled(@Body() dto: SendRegistrationCancelledTestDto) {
    return this.mailTestingService.sendRegistrationCancelled(dto);
  }

  @Post('registration-failed')
  @ApiOperation({ summary: 'Send test registration failed email' })
  @ApiOkResponse()
  sendRegistrationFailed(@Body() dto: SendRegistrationFailedTestDto) {
    return this.mailTestingService.sendRegistrationFailed(dto);
  }
}
