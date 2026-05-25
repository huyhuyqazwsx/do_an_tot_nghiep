import { baseEmailTemplate } from './base.template';

export interface RegistrationCancelledData {
  studentName: string;
  sectionCode: string;
  courseName: string;
  courseCode: string;
  semester: string;
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

export const registrationCancelledTemplate = (
  data: RegistrationCancelledData,
): string => {
  const content = `
    <!-- Status badge -->
    <div style="display:inline-flex;align-items:center;gap:8px;
                background:#fff3e0;border:1px solid #ffcc80;
                border-radius:24px;padding:8px 18px;margin-bottom:24px;">
      <span style="font-size:18px;">🔔</span>
      <span style="font-size:14px;font-weight:700;color:#e65100;">
        Hủy đăng ký tín chỉ thành công
      </span>
    </div>

    <p style="margin:0 0 8px;font-size:15px;color:#424242;">
      Xin chào <strong style="color:#1565c0;">${data.studentName}</strong>,
    </p>
    <p style="margin:0 0 24px;font-size:14px;color:#616161;line-height:1.7;">
      Yêu cầu hủy đăng ký của bạn đã được xử lý thành công.
      Lớp học phần sau đã được gỡ khỏi thời khóa biểu:
    </p>

    <!-- Info table -->
    <table width="100%" cellpadding="0" cellspacing="0"
           style="border:1px solid #e0e0e0;border-radius:8px;
                  border-collapse:collapse;overflow:hidden;margin-bottom:24px;">
      ${infoRow('Môn học', data.courseName)}
      ${infoRow('Mã môn', `<code style="background:#f5f5f5;padding:2px 6px;border-radius:4px;font-size:13px;">${data.courseCode}</code>`)}
      ${infoRow('Mã lớp', `<code style="background:#f5f5f5;padding:2px 6px;border-radius:4px;font-size:13px;">${data.sectionCode}</code>`)}
      ${infoRow('Học kỳ', data.semester)}
    </table>

    <div style="background:#fff8e1;border-left:4px solid #ffa000;
                border-radius:0 8px 8px 0;padding:12px 16px;margin-bottom:16px;">
      <p style="margin:0;font-size:13px;color:#795548;line-height:1.6;">
        <strong>Lưu ý:</strong> Nếu bạn không thực hiện yêu cầu này, hãy liên hệ
        ngay với phòng đào tạo để được hỗ trợ.
      </p>
    </div>

    <p style="margin:0;font-size:13px;color:#9e9e9e;">
      Thời gian xử lý: <strong>${new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}</strong>
    </p>
  `;

  return baseEmailTemplate(content);
};
