import { Injectable, Logger } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import { MailTemplateService } from './mail-template.service';
import type {
  RegistrationSuccessData,
  RegistrationCancelledData,
  RegistrationFailedData,
} from './mail-template.service';

export interface RawMailOptions {
  to: string;
  subject: string;
  html: string;
}

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly transporter: Transporter;

  constructor(private readonly template: MailTemplateService) {
    this.transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.MAIL_USER,
        pass: process.env.MAIL_APP_PASSWORD,
      },
    });
  }

  // ─── Low-level send ────────────────────────────────────────────────────────

  async send(options: RawMailOptions): Promise<void> {
    await this.transporter.sendMail({
      from: `"Cổng Đăng ký Tín chỉ — HUST" <${process.env.MAIL_USER}>`,
      to: options.to,
      subject: options.subject,
      html: options.html,
    });
    this.logger.log(`[Mail] Sent to ${options.to} | subject: "${options.subject}"`);
  }

  // ─── Typed methods theo từng event ─────────────────────────────────────────

  async sendRegistrationSuccess(
    to: string,
    data: RegistrationSuccessData,
  ): Promise<void> {
    const { subject, html } = this.template.registrationSuccess(data);
    await this.send({ to, subject, html });
  }

  async sendRegistrationCancelled(
    to: string,
    data: RegistrationCancelledData,
  ): Promise<void> {
    const { subject, html } = this.template.registrationCancelled(data);
    await this.send({ to, subject, html });
  }

  async sendRegistrationFailed(
    to: string,
    data: RegistrationFailedData,
  ): Promise<void> {
    const { subject, html } = this.template.registrationFailed(data);
    await this.send({ to, subject, html });
  }
}
