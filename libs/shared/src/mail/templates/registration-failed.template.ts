export interface RegistrationFailedData {
  studentName: string;
  courseName: string;
  maLop: string;
  reason: string;
}

export const registrationFailedTemplate = (data: RegistrationFailedData): string => `
<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
  <h2 style="color: #c62828;">❌ Đăng ký tín chỉ thất bại</h2>
  <p>Xin chào <strong>${data.studentName}</strong>,</p>
  <p>Yêu cầu đăng ký lớp <strong>${data.maLop} - ${data.courseName}</strong> không thành công.</p>
  <p><strong>Lý do:</strong> ${data.reason}</p>
  <p style="color: #666; font-size: 12px; margin-top: 20px;">
    Email này được gửi tự động, vui lòng không phản hồi.
  </p>
</div>
`;
