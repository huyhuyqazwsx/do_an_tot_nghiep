import { Injectable, Logger } from '@nestjs/common';
import {
  isRegistrationSlotOutsideCurrentWindow,
  PrismaService,
} from '@app/shared';
import {
  NotificationStatus,
  RegistrationBatchItemStatus,
  RegistrationBatchStatus,
  RegistrationBatchType,
  type RegistrationSlot,
} from '@prisma/client';
import * as nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';

const DEFAULT_MAX_NOTIFICATION_RETRIES = 3;
const DEFAULT_SCAN_LIMIT = 200;

type PendingBatch = Awaited<
  ReturnType<RegistrationNotificationService['findPendingBatches']>
>[number];

type GroupedPendingBatch = {
  userId: string;
  semester: string;
  user: PendingBatch['user'];
  batchIds: string[];
};

@Injectable()
export class RegistrationNotificationService {
  private readonly logger = new Logger(RegistrationNotificationService.name);
  private transporter?: Transporter;

  constructor(private readonly prisma: PrismaService) {}

  async sendPendingSummaries(): Promise<void> {
    const batches = await this.findPendingBatches();
    if (batches.length === 0) return;

    const groups = this.groupPendingBatches(batches);
    for (const group of groups) {
      await this.processGroup(group);
    }
  }

  private async processGroup(group: GroupedPendingBatch) {
    const slot = await this.findClosedSlot(group.semester, group.user.studentCode);
    if (!slot) return;

    const batchIds = await this.findAllUnsentBatchIds(
      group.userId,
      group.semester,
    );
    if (batchIds.length === 0) return;

    try {
      const summary = await this.buildSummary(group.userId, group.semester, batchIds);
      await this.sendSummaryMail(group.user, group.semester, slot, summary);
      await this.prisma.registrationBatch.updateMany({
        where: { id: { in: batchIds } },
        data: {
          notificationStatus: NotificationStatus.SENT,
          notificationSentAt: new Date(),
          notificationError: null,
        },
      });
      this.logger.log(
        `[RegistrationNotification] Sent summary to ${group.user.studentCode}/${group.semester}, batches=${batchIds.length}`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.prisma.registrationBatch.updateMany({
        where: { id: { in: batchIds } },
        data: {
          notificationStatus: NotificationStatus.FAILED,
          notificationRetryCount: { increment: 1 },
          notificationError: message.slice(0, 1000),
        },
      });
      this.logger.warn(
        `[RegistrationNotification] Failed for ${group.user.studentCode}/${group.semester}: ${message}`,
      );
    }
  }

  private async findPendingBatches() {
    return this.prisma.registrationBatch.findMany({
      where: {
        status: RegistrationBatchStatus.COMPLETED,
        notificationStatus: {
          in: [NotificationStatus.PENDING, NotificationStatus.FAILED],
        },
        notificationRetryCount: { lt: this.maxRetries },
      },
      select: {
        id: true,
        userId: true,
        semester: true,
        user: {
          select: {
            id: true,
            studentCode: true,
            name: true,
            email: true,
          },
        },
      },
      orderBy: [{ processedAt: 'asc' }, { createdAt: 'asc' }],
      take: this.scanLimit,
    });
  }

  private async findAllUnsentBatchIds(userId: string, semester: string) {
    const batches = await this.prisma.registrationBatch.findMany({
      where: {
        userId,
        semester,
        status: RegistrationBatchStatus.COMPLETED,
        notificationStatus: {
          in: [NotificationStatus.PENDING, NotificationStatus.FAILED],
        },
        notificationRetryCount: { lt: this.maxRetries },
      },
      select: { id: true },
    });

    return batches.map((batch) => batch.id);
  }

  private groupPendingBatches(batches: PendingBatch[]) {
    const grouped = new Map<string, GroupedPendingBatch>();
    for (const batch of batches) {
      const key = `${batch.userId}:${batch.semester}`;
      const current = grouped.get(key);
      if (current) {
        current.batchIds.push(batch.id);
        continue;
      }

      grouped.set(key, {
        userId: batch.userId,
        semester: batch.semester,
        user: batch.user,
        batchIds: [batch.id],
      });
    }

    return [...grouped.values()];
  }

  private async findClosedSlot(semester: string, studentCode: string) {
    const slots = await this.prisma.registrationSlot.findMany({
      where: {
        semester,
        studentCodeFrom: { lte: studentCode },
        studentCodeTo: { gte: studentCode },
      },
      orderBy: [{ startDate: 'asc' }, { startTime: 'asc' }],
    });

    return (
      slots.find((slot) => isRegistrationSlotOutsideCurrentWindow(slot)) ?? null
    );
  }

  private async buildSummary(userId: string, semester: string, batchIds: string[]) {
    const [registeredItems, recentItems] = await Promise.all([
      this.findActiveRegistrationItems(userId, semester),
      this.findRecentBatchItems(batchIds),
    ]);

    const failedItems = recentItems.filter(
      (item) => item.status === RegistrationBatchItemStatus.FAILED,
    );
    const cancelledItems = recentItems.filter(
      (item) => item.status === RegistrationBatchItemStatus.CANCELLED,
    );

    return {
      registeredItems,
      failedItems,
      cancelledItems,
    };
  }

  private async findActiveRegistrationItems(userId: string, semester: string) {
    const items = await this.prisma.registrationBatchItem.findMany({
      where: {
        status: RegistrationBatchItemStatus.SUCCESS,
        classSectionId: { not: null },
        batch: { userId, semester, type: RegistrationBatchType.CREATE },
      },
      select: {
        id: true,
        classSectionId: true,
        processedAt: true,
        createdAt: true,
        classSection: {
          select: {
            sectionCode: true,
            dayOfWeek: true,
            timeOfDay: true,
            startPeriod: true,
            endPeriod: true,
            timeRange: true,
            weekRange: true,
            room: true,
            course: {
              select: { code: true, name: true, credits: true },
            },
          },
        },
      },
      orderBy: [{ processedAt: 'desc' }, { createdAt: 'desc' }],
    });

    const latestBySection = new Map<string, (typeof items)[0]>();
    for (const item of items) {
      if (!item.classSectionId || !item.classSection) continue;
      if (!latestBySection.has(item.classSectionId)) {
        latestBySection.set(item.classSectionId, item);
      }
    }

    return [...latestBySection.values()];
  }

  private async findRecentBatchItems(batchIds: string[]) {
    return this.prisma.registrationBatchItem.findMany({
      where: {
        batchId: { in: batchIds },
        classSectionId: { not: null },
      },
      select: {
        id: true,
        status: true,
        failureReason: true,
        classSection: {
          select: {
            sectionCode: true,
            course: {
              select: { code: true, name: true },
            },
          },
        },
      },
      orderBy: [{ processedAt: 'desc' }, { createdAt: 'desc' }],
    });
  }

  private async sendSummaryMail(
    user: GroupedPendingBatch['user'],
    semester: string,
    slot: RegistrationSlot,
    summary: Awaited<ReturnType<RegistrationNotificationService['buildSummary']>>,
  ) {
    const transporter = this.getTransporter();
    await transporter.sendMail({
      from: process.env.MAIL_USER,
      to: user.email,
      subject: `Kết quả đăng ký học phần kỳ ${semester}`,
      text: this.renderText(user, semester, slot, summary),
      html: this.renderHtml(user, semester, slot, summary),
    });
  }

  private getTransporter() {
    if (this.transporter) return this.transporter;

    const user = process.env.MAIL_USER;
    const pass = process.env.MAIL_APP_PASSWORD;
    if (!user || !pass) {
      throw new Error('MAIL_USER hoặc MAIL_APP_PASSWORD chưa được cấu hình');
    }

    this.transporter = nodemailer.createTransport({
      service: 'Gmail',
      auth: { user, pass },
    });
    return this.transporter;
  }

  private renderText(
    user: GroupedPendingBatch['user'],
    semester: string,
    slot: RegistrationSlot,
    summary: Awaited<ReturnType<RegistrationNotificationService['buildSummary']>>,
  ) {
    const registered = summary.registeredItems.length
      ? summary.registeredItems
          .map((item) => {
            const section = item.classSection;
            return `- ${section?.sectionCode ?? ''} | ${section?.course.code ?? ''} - ${section?.course.name ?? ''}`;
          })
          .join('\n')
      : 'Chưa có lớp đăng ký thành công.';

    const failed = summary.failedItems.length
      ? summary.failedItems
          .map((item) => {
            const section = item.classSection;
            return `- ${section?.sectionCode ?? ''} | ${section?.course.code ?? ''}: ${item.failureReason ?? 'Không rõ lỗi'}`;
          })
          .join('\n')
      : 'Không có mục thất bại trong các batch chưa thông báo.';

    return [
      `Xin chào ${user.name},`,
      `Kết quả đăng ký học phần kỳ ${semester}.`,
      `Khung đăng ký: ${slot.startDate} đến ${slot.endDate}, ${slot.startTime} đến ${slot.endTime} mỗi ngày.`,
      '',
      'Lớp đang đăng ký thành công:',
      registered,
      '',
      'Mục thất bại cần lưu ý:',
      failed,
    ].join('\n');
  }

  private renderHtml(
    user: GroupedPendingBatch['user'],
    semester: string,
    slot: RegistrationSlot,
    summary: Awaited<ReturnType<RegistrationNotificationService['buildSummary']>>,
  ) {
    const registeredRows = summary.registeredItems.length
      ? summary.registeredItems
          .map((item) => {
            const section = item.classSection;
            return `
              <tr>
                <td>${this.escapeHtml(section?.sectionCode ?? '')}</td>
                <td>${this.escapeHtml(section?.course.code ?? '')}</td>
                <td>${this.escapeHtml(section?.course.name ?? '')}</td>
                <td>${section?.course.credits ?? ''}</td>
                <td>${this.formatSchedule(section)}</td>
              </tr>
            `;
          })
          .join('')
      : '<tr><td colspan="5">Chưa có lớp đăng ký thành công.</td></tr>';

    const failedRows = summary.failedItems.length
      ? summary.failedItems
          .map((item) => {
            const section = item.classSection;
            return `
              <tr>
                <td>${this.escapeHtml(section?.sectionCode ?? '')}</td>
                <td>${this.escapeHtml(section?.course.code ?? '')}</td>
                <td>${this.escapeHtml(section?.course.name ?? '')}</td>
                <td>${this.escapeHtml(item.failureReason ?? 'Không rõ lỗi')}</td>
              </tr>
            `;
          })
          .join('')
      : '<tr><td colspan="4">Không có mục thất bại trong các batch chưa thông báo.</td></tr>';

    return `
      <div style="font-family:Arial,sans-serif;color:#111827;line-height:1.5">
        <h2>Kết quả đăng ký học phần kỳ ${this.escapeHtml(semester)}</h2>
        <p>Xin chào ${this.escapeHtml(user.name)} (${this.escapeHtml(user.studentCode)}),</p>
        <p>Khung đăng ký của bạn: ${slot.startDate} đến ${slot.endDate}, ${slot.startTime} đến ${slot.endTime} mỗi ngày.</p>

        <h3>Lớp đang đăng ký thành công</h3>
        <table border="1" cellpadding="8" cellspacing="0" style="border-collapse:collapse;width:100%">
          <thead>
            <tr>
              <th>Mã lớp</th>
              <th>Mã môn</th>
              <th>Tên môn</th>
              <th>TC</th>
              <th>Lịch</th>
            </tr>
          </thead>
          <tbody>${registeredRows}</tbody>
        </table>

        <h3>Mục thất bại cần lưu ý</h3>
        <table border="1" cellpadding="8" cellspacing="0" style="border-collapse:collapse;width:100%">
          <thead>
            <tr>
              <th>Mã lớp</th>
              <th>Mã môn</th>
              <th>Tên môn</th>
              <th>Lý do</th>
            </tr>
          </thead>
          <tbody>${failedRows}</tbody>
        </table>

        <p style="color:#6b7280;font-size:12px">Email này được gửi tự động sau khi khung đăng ký của bạn kết thúc.</p>
      </div>
    `;
  }

  private formatSchedule(
    section: Awaited<
      ReturnType<RegistrationNotificationService['findActiveRegistrationItems']>
    >[number]['classSection'],
  ) {
    if (!section) return '';
    const parts = [
      section.dayOfWeek ? `Thứ ${section.dayOfWeek}` : null,
      section.timeOfDay,
      section.startPeriod && section.endPeriod
        ? `Tiết ${section.startPeriod}-${section.endPeriod}`
        : null,
      section.timeRange,
      section.weekRange ? `Tuần ${section.weekRange}` : null,
      section.room ? `Phòng ${section.room}` : null,
    ].filter(Boolean);

    return this.escapeHtml(parts.join(', '));
  }

  private escapeHtml(value: string) {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  private get maxRetries() {
    return (
      Number(process.env.REGISTRATION_NOTIFICATION_MAX_RETRIES) ||
      DEFAULT_MAX_NOTIFICATION_RETRIES
    );
  }

  private get scanLimit() {
    return (
      Number(process.env.REGISTRATION_NOTIFICATION_SCAN_LIMIT) ||
      DEFAULT_SCAN_LIMIT
    );
  }
}
