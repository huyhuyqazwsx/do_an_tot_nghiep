import { Injectable } from '@nestjs/common';
import {
  registrationSuccessTemplate,
  type RegistrationSuccessData,
} from './templates/registration-success.template';
import {
  registrationCancelledTemplate,
  type RegistrationCancelledData,
} from './templates/registration-cancelled.template';
import {
  registrationFailedTemplate,
  type RegistrationFailedData,
} from './templates/registration-failed.template';

export { RegistrationSuccessData, RegistrationCancelledData, RegistrationFailedData };

export interface RenderedMail {
  subject: string;
  html: string;
}

/**
 * Service render HTML email từ templates.
 * Tách biệt với MailService (chỉ lo transport) để dễ test.
 */
@Injectable()
export class MailTemplateService {
  registrationSuccess(data: RegistrationSuccessData): RenderedMail {
    return {
      subject: `✅ Đăng ký thành công: ${data.courseName} (${data.sectionCode}) — HK${data.semester}`,
      html: registrationSuccessTemplate(data),
    };
  }

  registrationCancelled(data: RegistrationCancelledData): RenderedMail {
    return {
      subject: `🔔 Hủy đăng ký: ${data.courseName} (${data.sectionCode}) — HK${data.semester}`,
      html: registrationCancelledTemplate(data),
    };
  }

  registrationFailed(data: RegistrationFailedData): RenderedMail {
    return {
      subject: `❌ Đăng ký không thành công: ${data.courseName} (${data.sectionCode})`,
      html: registrationFailedTemplate(data),
    };
  }
}
