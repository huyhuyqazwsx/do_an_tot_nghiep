/**
 * Base HTML layout cho tất cả email.
 * Nhận content HTML và wrap vào layout cố định.
 */
export const baseEmailTemplate = (content: string): string => `
<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Hệ thống Đăng ký Tín chỉ — HUST</title>
</head>
<body style="margin:0;padding:0;background-color:#f4f6f9;font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f6f9;padding:32px 0;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0"
               style="max-width:600px;width:100%;background:#ffffff;border-radius:12px;
                      box-shadow:0 2px 12px rgba(0,0,0,0.08);overflow:hidden;">

          <!-- Header -->
          <tr>
            <td style="background:linear-gradient(135deg,#1565c0 0%,#0d47a1 100%);
                        padding:28px 32px;">
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td>
                    <p style="margin:0;font-size:11px;color:rgba(255,255,255,0.7);
                               letter-spacing:1.5px;text-transform:uppercase;font-weight:600;">
                      Đại học Bách khoa Hà Nội
                    </p>
                    <h1 style="margin:4px 0 0;font-size:20px;font-weight:700;color:#ffffff;
                                letter-spacing:-0.3px;">
                      Cổng Đăng ký Tín chỉ
                    </h1>
                  </td>
                  <td align="right">
                    <span style="font-size:32px;">🎓</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:32px;">
              ${content}
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background:#f8f9fb;border-top:1px solid #e8ecf0;
                        padding:20px 32px;">
              <p style="margin:0;font-size:12px;color:#9e9e9e;line-height:1.6;">
                Email này được gửi tự động từ hệ thống đăng ký tín chỉ.
                Vui lòng không phản hồi email này.<br/>
                Nếu bạn cần hỗ trợ, hãy liên hệ phòng đào tạo.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
`;
