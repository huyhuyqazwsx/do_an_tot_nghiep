import { baseEmailTemplate } from './base.template';

export interface RegistrationSuccessData {
  studentName: string;
  sectionCode: string; // mã lớp (VD: 169995)
  courseName: string;
  courseCode: string; // mã môn (VD: AC2070)
  semester: string;
  remainingSlots?: number;
}

const infoRow = (label: string, value: string) => `
  <tr>
    <td style="padding:10px 14px;border-bottom:1px solid #f0f0f0;
               font-size:13px;color:#757575;font-weight:600;
               width:140px;white-space:nowrap;">
      ${label}
    </td>
    <td style="padding:10px 14px;border-bottom:1px solid #f0f0f0;
               font-size:14px;color:#212121;">
      ${value}
    </td>
  </tr>
`;

export const registrationSuccessTemplate = (data: RegistrationSuccessData): string => {
  const content = `
    <!-- Status badge -->
    <div style="display:inline-flex;align-items:center;gap:8px;
                background:#e8f5e9;border:1px solid #a5d6a7;
                border-radius:24px;padding:8px 18px;margin-bottom:24px;">
      <span style="font-size:18px;">✅</span>
      <span style="font-size:14px;font-weight:700;color:#2e7d32;">
        Đăng ký tín chỉ thành công
      </span>
    </div>

    <p style="margin:0 0 8px;font-size:15px;color:#424242;">
      Xin chào <strong style="color:#1565c0;">${data.studentName}</strong>,
    </p>
    <p style="margin:0 0 24px;font-size:14px;color:#616161;line-height:1.7;">
      Hệ thống đã ghi nhận đăng ký lớp học phần của bạn.
      Thông tin chi tiết như sau:
    </p>

    <!-- Info table -->
    <table width="100%" cellpadding="0" cellspacing="0"
           style="border:1px solid #e0e0e0;border-radius:8px;
                  border-collapse:collapse;overflow:hidden;margin-bottom:24px;">
      ${infoRow('Môn học', `${data.courseName}`)}
      ${infoRow('Mã môn', `<code style="background:#f5f5f5;padding:2px 6px;border-radius:4px;font-size:13px;">${data.courseCode}</code>`)}
      ${infoRow('Mã lớp', `<code style="background:#f5f5f5;padding:2px 6px;border-radius:4px;font-size:13px;">${data.sectionCode}</code>`)}
      ${infoRow('Học kỳ', data.semester)}
      ${
        data.remainingSlots !== undefined
          ? infoRow(
              'Còn lại',
              `<span style="color:${data.remainingSlots < 5 ? '#e65100' : '#2e7d32'};font-weight:600;">
                ${data.remainingSlots} chỗ
              </span>`,
            )
          : ''
      }
    </table>

    <p style="margin:0;font-size:13px;color:#9e9e9e;">
      Thời gian ghi nhận: <strong>${new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}</strong>
    </p>
  `;

  return baseEmailTemplate(content);
};
