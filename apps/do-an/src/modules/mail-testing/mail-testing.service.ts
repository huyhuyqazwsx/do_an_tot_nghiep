import { Injectable } from '@nestjs/common';
import { MailService } from '@app/shared';
import type { SendRegistrationSuccessTestDto } from './dto/send-registration-success-test.dto';
import type { SendRegistrationCancelledTestDto } from './dto/send-registration-cancelled-test.dto';
import type { SendRegistrationFailedTestDto } from './dto/send-registration-failed-test.dto';

@Injectable()
export class MailTestingService {
  constructor(private readonly mailService: MailService) {}

  async sendRegistrationSuccess(dto: SendRegistrationSuccessTestDto) {
    await this.mailService.sendRegistrationSuccess(dto.to, {
      studentName: dto.studentName,
      sectionCode: dto.sectionCode,
      courseName: dto.courseName,
      courseCode: dto.courseCode,
      semester: dto.semester,
      remainingSlots: dto.remainingSlots,
    });

    return { sent: true };
  }

  async sendRegistrationCancelled(dto: SendRegistrationCancelledTestDto) {
    await this.mailService.sendRegistrationCancelled(dto.to, {
      studentName: dto.studentName,
      sectionCode: dto.sectionCode,
      courseName: dto.courseName,
      courseCode: dto.courseCode,
      semester: dto.semester,
    });

    return { sent: true };
  }

  async sendRegistrationFailed(dto: SendRegistrationFailedTestDto) {
    await this.mailService.sendRegistrationFailed(dto.to, {
      studentName: dto.studentName,
      sectionCode: dto.sectionCode,
      courseName: dto.courseName,
      courseCode: dto.courseCode,
      reason: dto.reason,
    });

    return { sent: true };
  }
}
