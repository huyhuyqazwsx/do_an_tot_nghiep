import { baseEmailTemplate } from './base.template';

export interface RegistrationFailedData {
  studentName: string;
  sectionCode: string;
  courseName: string;
  courseCode: string;
  reason: string;
}

export const registrationFailedTemplate = (
  data: RegistrationFailedData,
): string => {
  const content = `
    <!-- Status badge -->
    <div style="display:inline-flex;align-items:center;gap:8px;
                background:#ffebee;border:1px solid #ef9a9a;
                border-radius:24px;padding:8px 18px;margin-bottom:24px;">
      <span style="font-size:18px;">❌</span>
      <span style="font-size:14px;font-weight:700;color:#c62828;">
        Đăng ký tín chỉ không thành công
      </span>
    </div>

    <p style="margin:0 0 8px;font-size:15px;color:#424242;">
      Xin chào <strong style="color:#1565c0;">${data.studentName}</strong>,
    </p>
    <p style="margin:0 0 24px;font-size:14px;color:#616161;line-height:1.7;">
      Yêu cầu đăng ký lớp học phần dưới đây của bạn không thể được thực hiện:
    </p>

    <!-- Course info -->
    <div style="background:#f8f9fa;border:1px solid #e0e0e0;border-radius:8px;
                padding:16px 20px;margin-bottom:20px;">
      <p style="margin:0 0 4px;font-size:13px;color:#9e9e9e;font-weight:600;
                letter-spacing:0.5px;text-transform:uppercase;">
        Lớp học phần
      </p>
      <p style="margin:0;font-size:16px;font-weight:700;color:#212121;">
        ${data.courseName}
      </p>
      <p style="margin:4px 0 0;font-size:13px;color:#757575;">
        Mã môn: <code style="background:#eeeeee;padding:1px 5px;border-radius:3px;">${data.courseCode}</code>
        &nbsp;·&nbsp;
        Mã lớp: <code style="background:#eeeeee;padding:1px 5px;border-radius:3px;">${data.sectionCode}</code>
      </p>
    </div>

    <!-- Reason -->
    <div style="background:#ffebee;border-left:4px solid #e53935;
                border-radius:0 8px 8px 0;padding:14px 18px;margin-bottom:24px;">
      <p style="margin:0 0 4px;font-size:12px;color:#b71c1c;font-weight:700;
                letter-spacing:0.5px;text-transform:uppercase;">
        Lý do
      </p>
      <p style="margin:0;font-size:14px;color:#212121;line-height:1.6;">
        ${data.reason}
      </p>
    </div>

    <p style="margin:0;font-size:14px;color:#616161;line-height:1.7;">
      Bạn có thể thử đăng ký lại trong thời gian cho phép hoặc chọn lớp học phần khác.
    </p>
  `;

  return baseEmailTemplate(content);
};
