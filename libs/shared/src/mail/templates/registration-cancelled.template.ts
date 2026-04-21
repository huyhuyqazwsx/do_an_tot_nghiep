export interface RegistrationCancelledData {
  studentName: string;
  courseName: string;
  maLop: string;
  semester: string;
}

export const registrationCancelledTemplate = (data: RegistrationCancelledData): string => `
<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
  <h2 style="color: #e65100;">🔔 Hủy đăng ký tín chỉ thành công</h2>
  <p>Xin chào <strong>${data.studentName}</strong>,</p>
  <p>Bạn đã hủy đăng ký lớp học phần sau:</p>
  <table style="border-collapse: collapse; width: 100%;">
    <tr>
      <td style="padding: 8px; border: 1px solid #ddd; background: #f5f5f5;"><strong>Môn học</strong></td>
      <td style="padding: 8px; border: 1px solid #ddd;">${data.courseName}</td>
    </tr>
    <tr>
      <td style="padding: 8px; border: 1px solid #ddd; background: #f5f5f5;"><strong>Mã lớp</strong></td>
      <td style="padding: 8px; border: 1px solid #ddd;">${data.maLop}</td>
    </tr>
    <tr>
      <td style="padding: 8px; border: 1px solid #ddd; background: #f5f5f5;"><strong>Học kỳ</strong></td>
      <td style="padding: 8px; border: 1px solid #ddd;">${data.semester}</td>
    </tr>
  </table>
  <p style="color: #666; font-size: 12px; margin-top: 20px;">
    Email này được gửi tự động, vui lòng không phản hồi.
  </p>
</div>
`;
