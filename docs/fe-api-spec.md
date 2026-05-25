# FE API Specification

Tài liệu này đặc tả các API mà frontend `do_an_fe` cần để thay thế mock data hiện tại.

Quy ước trạng thái:

- `Hiện có`: BE hiện tại đã có controller/endpoint tương ứng.
- `Cần bổ sung`: FE cần endpoint này nhưng BE hiện tại chưa có hoặc chưa đủ dữ liệu.

## Quy Ước Chung

Base URL đề xuất:

```text
http://localhost:3000
```

Header cho API cần đăng nhập:

```http
Authorization: Bearer <accessToken>
Content-Type: application/json
```

Header upload file:

```http
Authorization: Bearer <accessToken>
Content-Type: multipart/form-data
```

Response lỗi chuẩn nên thống nhất:

```json
{
  "statusCode": 400,
  "message": "Thông tin request không hợp lệ",
  "error": "Bad Request"
}
```

Response phân trang:

```json
{
  "items": [],
  "meta": {
    "page": 1,
    "limit": 20,
    "total": 100,
    "totalPages": 5
  }
}
```

## Mapping Dữ Liệu FE Và BE

| FE mock | BE/Prisma | Ghi chú |
| --- | --- | --- |
| `studentId` | `studentCode` | MSSV |
| `maLop` | `sectionCode` | Mã lớp hiển thị |
| `maLopKem` | `linkedSectionCode` | Lớp kèm |
| `courseCode` | `course.code` | Mã học phần |
| `khoiLuong` | `courseLoad` | Khối lượng |
| `thu` | `dayOfWeek` | Thứ trong tuần |
| `kip` | `timeOfDay` | `MORNING`, `AFTERNOON`, `EVENING` |
| `tietBd` | `startPeriod` | Tiết bắt đầu |
| `tietKt` | `endPeriod` | Tiết kết thúc |
| `thoiGian` | `timeRange` | Ví dụ `0645-0910` |
| `tuan` | `weekRange` | Tuần học |
| `phong` | `room` | Phòng học |
| `loaiLop` | `sectionType` | Loại lớp |
| `datMo` | `openingGroup` | `A`, `B`, `AB` |
| `trangThai` | `sectionStatus` | Trạng thái lớp |
| `slMax` | `maxCapacity` | Sĩ số tối đa |
| `slDk` | `registeredCount` | Số đã đăng ký |

Lưu ý quan trọng: FE chọn lớp bằng `maLop` (tương ứng `sectionCode`). API đăng ký của BE nhận `sectionCodes` (mã lớp). BE sẽ tự resolve `sectionCode → classSectionId` nội bộ.

---

# 1. Auth Module

## 1.1. Đăng nhập

Trạng thái: `Hiện có`

```http
POST /api/auth/login
```

Mục đích: Đăng nhập sinh viên hoặc admin, nhận JWT access token.

Request:

```json
{
  "studentCode": "20215678",
  "password": "password"
}
```

Response:

```json
{
  "accessToken": "jwt-token",
  "user": {
    "id": "uuid-user",
    "studentCode": "20215678",
    "name": "Nguyễn Văn An",
    "email": "an.nv215678@sis.hust.edu.vn",
    "role": "STUDENT",
    "courseYear": 2021,
    "department": "Công nghệ thông tin"
  }
}
```

FE dùng tại:

- `src/app/pages/Login.tsx`
- `src/app/pages/admin/AdminLogin.tsx`
- `src/app/lib/auth.tsx`

## 1.2. Lấy thông tin người dùng hiện tại

Trạng thái: `Hiện có`

```http
GET /api/auth/me
```

Mục đích: Khôi phục phiên đăng nhập sau reload, lấy role để route guard.

Response:

```json
{
  "id": "uuid-user",
  "studentCode": "20215678",
  "name": "Nguyễn Văn An",
  "email": "an.nv215678@sis.hust.edu.vn",
  "role": "STUDENT",
  "courseYear": 2021,
  "department": "Công nghệ thông tin"
}
```

## 1.3. Đăng xuất

Trạng thái: `Hiện có`

```http
POST /api/auth/logout
```

Mục đích: Đăng xuất, BE có thể blacklist token hoặc clear session server-side.

Response:

```json
{
  "message": "Logged out successfully"
}
```

---

# 2. Courses Module

## 2.1. Lấy danh sách học phần

Trạng thái: `Hiện có`

```http
GET /api/courses?page=1&limit=20&q=IT3040&department=CNTT&credits=3&sortBy=code&sortOrder=asc
```

Mục đích: Tra cứu môn học, admin quản lý môn học, hiển thị tên môn/tín chỉ cho lớp học phần.

Query:

| Tên | Kiểu | Bắt buộc | Mô tả |
| --- | --- | --- | --- |
| `page` | number | Không | Trang hiện tại |
| `limit` | number | Không | Số bản ghi/trang, tối đa 100 |
| `q` | string | Không | Tìm theo mã môn, tên môn, tên tiếng Anh, khoa viện |
| `department` | string | Không | Lọc theo khoa viện |
| `credits` | number | Không | Lọc số tín chỉ |
| `minCredits` | number | Không | Tín chỉ tối thiểu |
| `maxCredits` | number | Không | Tín chỉ tối đa |
| `sortBy` | string | Không | `code`, `name`, `credits`, `department`, `weight` |
| `sortOrder` | string | Không | `asc`, `desc` |

Response:

```json
{
  "items": [
    {
      "id": "uuid-course",
      "code": "IT3040",
      "name": "Cấu trúc dữ liệu và giải thuật",
      "englishName": "Data Structures and Algorithms",
      "credits": 3,
      "tuitionCredits": "3.0",
      "courseLoad": "3(3-1-0-6)",
      "department": "CNTT",
      "prerequisite": "IT1110",
      "weight": "1.0"
    }
  ],
  "meta": {
    "page": 1,
    "limit": 20,
    "total": 1,
    "totalPages": 1
  }
}
```

FE dùng tại:

- `SearchCourse.tsx`
- `AdminCourses.tsx`
- `Register.tsx`
- `Dashboard.tsx`

## 2.2. Lấy chi tiết học phần

Trạng thái: `Hiện có`

```http
GET /api/courses/:code
```

Mục đích: Xem chi tiết một học phần theo mã môn.

Response:

```json
{
  "id": "uuid-course",
  "code": "IT3040",
  "name": "Cấu trúc dữ liệu và giải thuật",
  "englishName": "Data Structures and Algorithms",
  "credits": 3,
  "tuitionCredits": "3.0",
  "courseLoad": "3(3-1-0-6)",
  "department": "CNTT",
  "prerequisite": "IT1110",
  "weight": "1.0"
}
```

## 2.3. Tạo học phần

Trạng thái: `Hiện có`

```http
POST /api/courses
```

Mục đích: Admin thêm môn học mới.

Request:

```json
{
  "code": "IT3040",
  "name": "Cấu trúc dữ liệu và giải thuật",
  "englishName": "Data Structures and Algorithms",
  "credits": 3,
  "tuitionCredits": 3,
  "courseLoad": "3(3-1-0-6)",
  "department": "CNTT",
  "prerequisite": "IT1110",
  "weight": 1
}
```

Response: giống API chi tiết học phần.

## 2.4. Cập nhật học phần

Trạng thái: `Hiện có`

```http
PATCH /api/courses/:code
```

Mục đích: Admin sửa thông tin môn học.

Request:

```json
{
  "name": "Cấu trúc dữ liệu và giải thuật",
  "credits": 3,
  "department": "CNTT"
}
```

Response: giống API chi tiết học phần.

## 2.5. Xóa học phần

Trạng thái: `Hiện có`

```http
DELETE /api/courses/:code
```

Mục đích: Admin xóa học phần chưa bị tham chiếu bởi lớp học phần/điểm.

Response:

```json
{
  "id": "uuid-course",
  "code": "IT3040",
  "name": "Cấu trúc dữ liệu và giải thuật"
}
```

## 2.6. Import học phần từ CSV

Trạng thái: `Hiện có`

```http
POST /api/courses/import
```

Mục đích: Admin import danh mục học phần từ file CSV.

Request: `multipart/form-data`

| Field | Kiểu | Bắt buộc |
| --- | --- | --- |
| `file` | CSV file | Có |

Response:

```json
{
  "fileName": "courses.csv",
  "totalRows": 412,
  "inserted": 400,
  "skippedExisting": 12
}
```

---

# 3. Class Sections Module

## 3.1. Lấy danh sách lớp học phần

Trạng thái: `Hiện có`

```http
GET /api/class-sections?page=1&limit=20&q=IT3040&semester=20252&courseCode=IT3040&sectionStatus=SCHEDULING
```

Mục đích: Danh sách lớp mở, tra cứu mã lớp, admin quản lý lớp học phần.

Query:

| Tên | Kiểu | Bắt buộc | Mô tả |
| --- | --- | --- | --- |
| `page` | number | Không | Trang hiện tại |
| `limit` | number | Không | Số bản ghi/trang |
| `q` | string | Không | Tìm mã lớp, mã môn, tên môn, phòng |
| `semester` | string | Không | Mã kỳ |
| `sectionCode` | string | Không | Mã lớp |
| `courseCode` | string | Không | Mã môn |
| `sectionType` | string | Không | Loại lớp |
| `sectionStatus` | string | Không | Trạng thái lớp |
| `sortBy` | string | Không | `sectionCode`, `semester`, `registeredCount`, `maxCapacity`, `createdAt` |
| `sortOrder` | string | Không | `asc`, `desc` |

Response:

```json
{
  "items": [
    {
      "id": "uuid-class-section",
      "sectionCode": "169995",
      "linkedSectionCode": null,
      "semester": "20252",
      "dayOfWeek": 2,
      "timeOfDay": "MORNING",
      "startPeriod": 1,
      "endPeriod": 3,
      "timeRange": "0645-0910",
      "weekRange": "25-32,34-42",
      "room": "D3-401",
      "sectionType": "LT_BT",
      "openingGroup": "AB",
      "sectionStatus": "SCHEDULING",
      "requiresLab": false,
      "maxCapacity": 80,
      "registeredCount": 67,
      "course": {
        "id": "uuid-course",
        "code": "IT3040",
        "name": "Cấu trúc dữ liệu và giải thuật",
        "credits": 3
      }
    }
  ],
  "meta": {
    "page": 1,
    "limit": 20,
    "total": 1,
    "totalPages": 1
  }
}
```

FE dùng tại:

- `Register.tsx`
- `SearchClass.tsx`
- `SearchCourse.tsx`
- `AdminClassSections.tsx`
- `WeekTimeline.tsx`

## 3.2. Lấy chi tiết lớp học phần

Trạng thái: `Hiện có`

```http
GET /api/class-sections/:id
```

Mục đích: Xem đủ thông tin một lớp học phần.

Response: một object giống item trong danh sách lớp học phần.

## 3.3. Tạo lớp học phần

Trạng thái: `Hiện có`

```http
POST /api/class-sections
```

Mục đích: Admin mở lớp học phần mới.

Request:

```json
{
  "sectionCode": "169995",
  "linkedSectionCode": null,
  "courseCode": "IT3040",
  "semester": "20252",
  "dayOfWeek": 2,
  "timeOfDay": "MORNING",
  "startPeriod": 1,
  "endPeriod": 3,
  "timeRange": "0645-0910",
  "weekRange": "25-32,34-42",
  "room": "D3-401",
  "sectionType": "LT_BT",
  "openingGroup": "AB",
  "sectionStatus": "SCHEDULING",
  "requiresLab": false,
  "note": null,
  "maxCapacity": 80,
  "registeredCount": 0
}
```

Response: object lớp học phần vừa tạo.

## 3.4. Cập nhật lớp học phần

Trạng thái: `Hiện có`

```http
PATCH /api/class-sections/:id
```

Mục đích: Admin sửa lịch, phòng, trạng thái, sĩ số.

Request:

```json
{
  "room": "D3-402",
  "maxCapacity": 100,
  "sectionStatus": "SCHEDULING"
}
```

Response: object lớp học phần sau cập nhật.

## 3.5. Xóa lớp học phần

Trạng thái: `Hiện có`

```http
DELETE /api/class-sections/:id
```

Mục đích: Admin xóa lớp học phần chưa có ràng buộc đăng ký.

Response:

```json
{
  "id": "uuid-class-section",
  "sectionCode": "169995"
}
```

## 3.6. Import lớp học phần từ CSV

Trạng thái: `Hiện có`

```http
POST /api/class-sections/import
```

Mục đích: Admin import TKB/lớp học phần từ CSV.

Request: `multipart/form-data`

| Field | Kiểu | Bắt buộc |
| --- | --- | --- |
| `file` | CSV file | Có |

Response:

```json
{
  "fileName": "TKB20252.csv",
  "totalRows": 1240,
  "inserted": 1200,
  "skippedDuplicateRows": 20,
  "skippedExisting": 20
}
```

## 3.7. Cập nhật trạng thái nhiều lớp

Trạng thái: `Cần bổ sung`

```http
PATCH /api/class-sections/bulk-status
```

Mục đích: Admin chọn nhiều lớp rồi mở/đóng đăng ký hàng loạt.

Request:

```json
{
  "classSectionIds": [
    "uuid-class-section-1",
    "uuid-class-section-2"
  ],
  "sectionStatus": "SCHEDULING"
}
```

Response:

```json
{
  "updated": 2,
  "items": [
    {
      "id": "uuid-class-section-1",
      "sectionCode": "169995",
      "sectionStatus": "SCHEDULING"
    }
  ]
}
```

---

# 4. Registrations Module

## 4.1. Lấy danh sách lớp đã đăng ký của sinh viên hiện tại

Trạng thái: `Hiện có`

```http
GET /api/registrations/my?semester=20252
```

Mục đích: Hiển thị lịch học của tôi và tab "Đã đăng ký".

Response:

```json
[
  {
    "id": "uuid-class-section",
    "batchItemId": "uuid-batch-item",
    "status": "ACTIVE",
    "registeredAt": "2026-05-18T08:10:00.000Z",
    "cancelledAt": null,
    "classSection": {
      "id": "uuid-class-section",
      "sectionCode": "170100",
      "semester": "20252",
      "dayOfWeek": 6,
      "timeOfDay": "MORNING",
      "startPeriod": 1,
      "endPeriod": 4,
      "timeRange": "0645-0955",
      "weekRange": "25-42",
      "room": "D9-301",
      "sectionType": "LT_BT",
      "maxCapacity": 70,
      "registeredCount": 30,
      "course": {
        "id": "uuid-course",
        "code": "IT3180",
        "name": "Nhập môn Công nghệ phần mềm",
        "credits": 3
      }
    }
  }
]
```

FE dùng tại:

- `Register.tsx`
- `MySchedule.tsx`
- `Dashboard.tsx`

## 4.2. Tạo batch đăng ký

Trạng thái: `Hiện có`

```http
POST /api/registrations/batches
```

Mục đích: Sinh viên gửi yêu cầu đăng ký nhiều lớp, BE đưa vào queue để worker xử lý.

Request:

```json
{
  "semester": "20252",
  "sectionCodes": [
    "169995",
    "170001"
  ]
}
```

Response:

```json
{
  "accepted": true,
  "batchId": "uuid-batch",
  "type": "CREATE",
  "semester": "20252",
  "totalItems": 2,
  "publish": {
    "ok": true
  }
}
```

Sau response này FE chuyển sang:

```text
/batch/:batchId
```

và polling API chi tiết batch.

## 4.3. Tạo batch hủy đăng ký

Trạng thái: `Hiện có`

```http
DELETE /api/registrations/batches
```

Mục đích: Sinh viên gửi yêu cầu hủy đăng ký nhiều lớp.

Request:

```json
{
  "semester": "20252",
  "sectionCodes": [
    "169995",
    "170001"
  ]
}
```

Response:

```json
{
  "accepted": true,
  "batchId": "uuid-batch",
  "type": "CANCEL",
  "semester": "20252",
  "totalItems": 2,
  "publish": {
    "ok": true
  }
}
```

## 4.4. Lấy chi tiết kết quả batch

Trạng thái: `Hiện có`

```http
GET /api/registrations/batches/:batchId
```

Mục đích: FE polling để cập nhật trạng thái đăng ký/hủy.

Response:

```json
{
  "id": "uuid-batch",
  "semester": "20252",
  "type": "CREATE",
  "status": "COMPLETED",
  "totalItems": 2,
  "createdAt": "2026-05-18T08:00:00.000Z",
  "processedAt": "2026-05-18T08:00:03.000Z",
  "items": [
    {
      "id": "uuid-batch-item",
      "classSectionId": "uuid-class-section",
      "status": "SUCCESS",
      "failureReason": null,
      "remainingSlots": 12,
      "createdAt": "2026-05-18T08:00:00.000Z",
      "processedAt": "2026-05-18T08:00:03.000Z",
      "classSection": {
        "id": "uuid-class-section",
        "sectionCode": "169995",
        "sectionType": "LT_BT",
        "course": {
          "id": "uuid-course",
          "code": "IT3040",
          "name": "Cấu trúc dữ liệu và giải thuật",
          "credits": 3
        }
      }
    }
  ]
}
```

FE dùng tại:

- `BatchResult.tsx`

## 4.5. Admin lấy danh sách đăng ký

Trạng thái: `Hiện có`

```http
GET /api/registrations?semester=20252&studentCode=20215678
```

Mục đích: Admin tra cứu sinh viên đã đăng ký lớp nào.

Response:

```json
[
  {
    "id": "uuid-class-section",
    "batchItemId": "uuid-batch-item",
    "status": "ACTIVE",
    "registeredAt": "2026-05-18T08:10:00.000Z",
    "cancelledAt": null,
    "user": {
      "id": "uuid-user",
      "studentCode": "20215678",
      "name": "Nguyễn Văn An"
    },
    "classSection": {
      "id": "uuid-class-section",
      "sectionCode": "169995",
      "sectionType": "LT_BT",
      "course": {
        "id": "uuid-course",
        "code": "IT3040",
        "name": "Cấu trúc dữ liệu và giải thuật",
        "credits": 3
      }
    }
  }
]
```

## 4.6. Lấy batch đang xử lý của sinh viên

Trạng thái: `Cần bổ sung`

```http
GET /api/registrations/batches/my?semester=20252&status=PENDING
```

Mục đích: Dashboard cần biết sau reload sinh viên còn batch pending hay không.

Response:

```json
{
  "items": [
    {
      "id": "uuid-batch",
      "type": "CREATE",
      "status": "PENDING",
      "semester": "20252",
      "totalItems": 2,
      "createdAt": "2026-05-18T08:00:00.000Z"
    }
  ]
}
```

---

# 5. Registration Sessions Module

## 5.1. Admin lấy danh sách cấu hình phiên đăng ký

Trạng thái: `Hiện có`

```http
GET /api/registration-sessions
```

Mục đích: Admin xem các kỳ đã cấu hình mở đăng ký.

Response:

```json
[
  {
    "id": "uuid-session",
    "semester": "20252",
    "name": "Đăng ký học phần kỳ 20252",
    "openAt": "2026-05-18T01:00:00.000Z",
    "closeAt": "2026-05-25T10:00:00.000Z",
    "isActive": true,
    "createdAt": "2026-05-01T00:00:00.000Z"
  }
]
```

FE dùng tại:

- `AdminSessions.tsx`
- `Dashboard.tsx`
- `AdminSettings.tsx`

## 5.2. Admin lấy cấu hình đăng ký theo kỳ

Trạng thái: `Hiện có`

```http
GET /api/registration-sessions/:semester
```

Mục đích: Xem cấu hình mở/đóng đăng ký của một kỳ.

Response: object session.

## 5.3. Admin tạo cấu hình phiên đăng ký

Trạng thái: `Hiện có`

```http
POST /api/registration-sessions
```

Request:

```json
{
  "semester": "20252",
  "name": "Đăng ký học phần kỳ 20252",
  "openAt": "2026-05-18T01:00:00.000Z",
  "closeAt": "2026-05-25T10:00:00.000Z",
  "isActive": true
}
```

Response: object session vừa tạo.

## 5.4. Admin cập nhật cấu hình phiên đăng ký

Trạng thái: `Hiện có`

```http
PATCH /api/registration-sessions/:semester
```

Request:

```json
{
  "name": "Đăng ký chính thức kỳ 20252",
  "openAt": "2026-05-18T01:00:00.000Z",
  "closeAt": "2026-05-25T10:00:00.000Z",
  "isActive": true
}
```

Response: object session sau cập nhật.

## 5.5. Admin xóa cấu hình phiên đăng ký

Trạng thái: `Hiện có`

```http
DELETE /api/registration-sessions/:semester
```

Response: object session đã xóa.

## 5.6. Sinh viên lấy phiên đăng ký hiện hành

Trạng thái: `Hiện có`

```http
GET /api/registration-sessions/current?semester=20252
```

Mục đích: Dashboard sinh viên hiển thị kỳ hiện tại, thời gian mở, countdown, trạng thái được phép đăng ký.

Response:

```json
{
  "id": "uuid-session",
  "semester": "20252",
  "name": "Đăng ký học phần kỳ 20252",
  "openAt": "2026-05-18T01:00:00.000Z",
  "closeAt": "2026-05-25T10:00:00.000Z",
  "isActive": true,
  "status": "RUNNING",
  "serverTime": "2026-05-18T02:00:00.000Z",
  "canRegister": true
}
```

## 5.7. Admin lấy thống kê phiên đăng ký

Trạng thái: `Hiện có` (hardcoded response)

```http
GET /api/registration-sessions/:semester/stats
```

Mục đích: Admin Dashboard và Admin Sessions cần tiến độ tham gia.

Response:

```json
{
  "semester": "20252",
  "estimatedStudents": 18230,
  "registeredStudents": 12480,
  "successRate": 96.4,
  "conflictCount": 312,
  "averageBatchProcessMs": 1800
}
```

## 5.8. CRUD slot đăng ký theo nhóm sinh viên

Trạng thái: `Cần bổ sung`

```http
GET /api/registration-sessions/:semester/slots
POST /api/registration-sessions/:semester/slots
PATCH /api/registration-sessions/:semester/slots/:slotId
DELETE /api/registration-sessions/:semester/slots/:slotId
```

Mục đích: FE admin hiện có audience theo khóa/ngành/hệ. BE Prisma đã có `RegistrationSlot`, nhưng chưa có controller.

Request tạo slot:

```json
{
  "name": "ĐK ưu tiên K21 CNTT",
  "studentFilter": {
    "courseYears": [2021],
    "departments": ["Công nghệ thông tin"],
    "programs": ["A", "B"]
  },
  "openAt": "2026-05-28T01:00:00.000Z",
  "closeAt": "2026-05-29T10:00:00.000Z",
  "prewarmAt": "2026-05-28T00:30:00.000Z"
}
```

Response:

```json
{
  "id": "uuid-slot",
  "sessionId": "uuid-session",
  "name": "ĐK ưu tiên K21 CNTT",
  "studentFilter": {
    "courseYears": [2021],
    "departments": ["Công nghệ thông tin"],
    "programs": ["A", "B"]
  },
  "openAt": "2026-05-28T01:00:00.000Z",
  "closeAt": "2026-05-29T10:00:00.000Z",
  "prewarmAt": "2026-05-28T00:30:00.000Z",
  "isPrewarmed": false,
  "prewarmedAt": null
}
```

---

# 6. Users Module

## 6.1. Admin lấy danh sách người dùng/sinh viên

Trạng thái: `Hiện có`

```http
GET /api/users?page=1&limit=20&q=20215678&role=STUDENT&courseYear=2021&department=CNTT&isActive=true
```

Mục đích: Admin quản lý sinh viên.

Response:

```json
{
  "items": [
    {
      "id": "uuid-user",
      "studentCode": "20215678",
      "name": "Nguyễn Văn An",
      "email": "an.nv215678@sis.hust.edu.vn",
      "role": "STUDENT",
      "courseYear": 2021,
      "department": "Công nghệ thông tin",
      "isActive": true,
      "createdAt": "2026-05-01T00:00:00.000Z"
    }
  ],
  "meta": {
    "page": 1,
    "limit": 20,
    "total": 1,
    "totalPages": 1
  }
}
```

FE dùng tại:

- `AdminStudents.tsx`
- `AdminGrades.tsx`
- `AdminSessions.tsx`

## 6.2. Admin lấy chi tiết người dùng

Trạng thái: `Hiện có`

```http
GET /api/users/:studentCode
```

Response:

```json
{
  "id": "uuid-user",
  "studentCode": "20215678",
  "name": "Nguyễn Văn An",
  "email": "an.nv215678@sis.hust.edu.vn",
  "role": "STUDENT",
  "courseYear": 2021,
  "department": "Công nghệ thông tin",
  "isActive": true,
  "createdAt": "2026-05-01T00:00:00.000Z"
}
```

## 6.3. Admin tạo user

Trạng thái: `Hiện có`

```http
POST /api/users
```

Request:

```json
{
  "studentCode": "20215678",
  "name": "Nguyễn Văn An",
  "email": "an.nv215678@sis.hust.edu.vn",
  "password": "password",
  "role": "STUDENT",
  "courseYear": 2021,
  "department": "Công nghệ thông tin",
  "isActive": true
}
```

Response: object user đã tạo, không trả password.

## 6.4. Admin cập nhật user

Trạng thái: `Hiện có`

```http
PATCH /api/users/:studentCode
```

Request:

```json
{
  "name": "Nguyễn Văn An",
  "email": "an.nv215678@sis.hust.edu.vn",
  "courseYear": 2021,
  "department": "Công nghệ thông tin",
  "isActive": true
}
```

Response: object user sau cập nhật.

## 6.5. Admin xóa user

Trạng thái: `Hiện có`

```http
DELETE /api/users/:studentCode
```

Response: object user đã xóa.

## 6.6. Admin import users từ CSV

Trạng thái: `Hiện có`

```http
POST /api/users/import
```

Request: `multipart/form-data`

| Field | Kiểu | Bắt buộc |
| --- | --- | --- |
| `file` | CSV file | Có |

Response:

```json
{
  "fileName": "students.csv",
  "totalRows": 1000,
  "inserted": 950,
  "skippedDuplicateRows": 10,
  "skippedExisting": 40
}
```

## 6.7. Admin lấy sinh viên kèm GPA và trạng thái học vụ

Trạng thái: `Cần bổ sung`

```http
GET /api/users/students/summary?page=1&limit=20&q=An&department=CNTT&courseYear=2021
```

Mục đích: FE `AdminStudents.tsx` đang hiển thị GPA, trạng thái `Đang học/Bảo lưu/Đã tốt nghiệp/Buộc thôi học`, hệ đào tạo. Prisma hiện chưa có đủ field.

Response:

```json
{
  "items": [
    {
      "studentCode": "20215678",
      "name": "Nguyễn Văn An",
      "email": "an.nv215678@sis.hust.edu.vn",
      "program": "A",
      "courseYear": 2021,
      "department": "Công nghệ thông tin",
      "academicStatus": "ACTIVE",
      "gpa": 3.42
    }
  ],
  "meta": {
    "page": 1,
    "limit": 20,
    "total": 1,
    "totalPages": 1
  }
}
```

---

# 7. Grades Module

BE hiện có model `StudentGrade` trong Prisma nhưng chưa có controller/module API.

## 7.1. Admin lấy danh sách sinh viên kèm thống kê điểm

Trạng thái: `Cần bổ sung`

```http
GET /api/grades/students?page=1&limit=20&q=20215678&department=CNTT
```

Mục đích: Trang `AdminGrades.tsx` danh sách sinh viên trước khi chọn một sinh viên.

Response:

```json
{
  "items": [
    {
      "studentCode": "20215678",
      "name": "Nguyễn Văn An",
      "email": "an.nv215678@sis.hust.edu.vn",
      "courseYear": 2021,
      "department": "Công nghệ thông tin",
      "gradeCount": 4,
      "gpa": 3.42
    }
  ],
  "meta": {
    "page": 1,
    "limit": 20,
    "total": 1,
    "totalPages": 1
  }
}
```

## 7.2. Admin lấy bảng điểm của một sinh viên

Trạng thái: `Cần bổ sung`

```http
GET /api/grades?studentCode=20215678&semester=20252
```

Mục đích: Hiển thị bảng điểm chi tiết.

Response:

```json
{
  "student": {
    "studentCode": "20215678",
    "name": "Nguyễn Văn An",
    "email": "an.nv215678@sis.hust.edu.vn",
    "courseYear": 2021,
    "department": "Công nghệ thông tin",
    "gpa": 3.42
  },
  "items": [
    {
      "id": "uuid-grade",
      "course": {
        "id": "uuid-course",
        "code": "IT3040",
        "name": "Cấu trúc dữ liệu và giải thuật",
        "credits": 3
      },
      "semester": "20252",
      "gradeLetter": "B_PLUS",
      "gradePoint": "3.5",
      "gradeNumber": "7.8",
      "createdAt": "2026-05-18T00:00:00.000Z"
    }
  ]
}
```

## 7.3. Admin tạo điểm

Trạng thái: `Cần bổ sung`

```http
POST /api/grades
```

Request:

```json
{
  "studentCode": "20215678",
  "courseCode": "IT3040",
  "semester": "20252",
  "gradeLetter": "B_PLUS",
  "gradePoint": 3.5,
  "gradeNumber": 7.8
}
```

Response:

```json
{
  "id": "uuid-grade",
  "studentCode": "20215678",
  "courseCode": "IT3040",
  "semester": "20252",
  "gradeLetter": "B_PLUS",
  "gradePoint": "3.5",
  "gradeNumber": "7.8"
}
```

## 7.4. Admin cập nhật điểm

Trạng thái: `Cần bổ sung`

```http
PATCH /api/grades/:id
```

Request:

```json
{
  "gradeLetter": "A",
  "gradePoint": 4,
  "gradeNumber": 8.8
}
```

Response: object grade sau cập nhật.

## 7.5. Admin xóa điểm

Trạng thái: `Cần bổ sung`

```http
DELETE /api/grades/:id
```

Response:

```json
{
  "id": "uuid-grade",
  "deleted": true
}
```

## 7.6. Admin lưu nhiều dòng điểm cùng lúc

Trạng thái: `Cần bổ sung`

```http
PUT /api/grades/bulk
```

Mục đích: FE đang chỉnh nhiều dòng điểm rồi bấm "Lưu thay đổi".

Request:

```json
{
  "studentCode": "20215678",
  "items": [
    {
      "id": "uuid-grade-existing",
      "courseCode": "IT3040",
      "semester": "20252",
      "gradeLetter": "B_PLUS",
      "gradePoint": 3.5,
      "gradeNumber": 7.8
    },
    {
      "courseCode": "IT4015",
      "semester": "20252",
      "gradeLetter": "A",
      "gradePoint": 4,
      "gradeNumber": 8.8
    }
  ],
  "deleteIds": [
    "uuid-grade-deleted"
  ]
}
```

Response:

```json
{
  "saved": 2,
  "deleted": 1,
  "items": []
}
```

---

# 8. Prewarm Module

BE hiện có scheduler/prewarm service nội bộ nhưng chưa có HTTP API cho admin.

## 8.1. Admin lấy danh sách lịch prewarm

Trạng thái: `Cần bổ sung`

```http
GET /api/prewarm/schedules?semester=20252
```

Mục đích: Trang `AdminPrewarm.tsx` xem lịch prewarm theo phiên/slot.

Response:

```json
{
  "items": [
    {
      "slotId": "uuid-slot",
      "sessionId": "uuid-session",
      "semester": "20252",
      "sessionName": "Đăng ký học phần kỳ 20252",
      "openAt": "2026-05-18T01:00:00.000Z",
      "prewarmAt": "2026-05-18T00:30:00.000Z",
      "leadMinutes": 30,
      "startedAt": "2026-05-18T00:30:00.000Z",
      "finishedAt": "2026-05-18T00:33:00.000Z",
      "classesLoaded": 1240,
      "totalClasses": 1240,
      "status": "READY",
      "notes": null
    }
  ]
}
```

## 8.2. Admin cập nhật lịch prewarm

Trạng thái: `Cần bổ sung`

```http
PATCH /api/prewarm/schedules/:slotId
```

Request:

```json
{
  "leadMinutes": 45,
  "prewarmAt": "2026-05-18T00:15:00.000Z"
}
```

Response:

```json
{
  "slotId": "uuid-slot",
  "prewarmAt": "2026-05-18T00:15:00.000Z",
  "leadMinutes": 45
}
```

## 8.3. Admin chạy prewarm ngay

Trạng thái: `Cần bổ sung`

```http
POST /api/prewarm/schedules/:slotId/run
```

Mục đích: Can thiệp thủ công trước giờ mở đăng ký.

Response:

```json
{
  "accepted": true,
  "slotId": "uuid-slot",
  "status": "RUNNING"
}
```

## 8.4. Admin retry prewarm lỗi

Trạng thái: `Cần bổ sung`

```http
POST /api/prewarm/schedules/:slotId/retry
```

Response:

```json
{
  "accepted": true,
  "slotId": "uuid-slot",
  "status": "RUNNING"
}
```

## 8.5. Lấy cấu hình prewarm mặc định

Trạng thái: `Cần bổ sung`

```http
GET /api/prewarm/settings
```

Response:

```json
{
  "autoSchedule": true,
  "defaultLeadMinutes": 30,
  "scope": "CURRENT_SEMESTER"
}
```

## 8.6. Cập nhật cấu hình prewarm mặc định

Trạng thái: `Cần bổ sung`

```http
PATCH /api/prewarm/settings
```

Request:

```json
{
  "autoSchedule": true,
  "defaultLeadMinutes": 30
}
```

Response:

```json
{
  "autoSchedule": true,
  "defaultLeadMinutes": 30,
  "scope": "CURRENT_SEMESTER"
}
```

---

# 9. Admin Dashboard Module

BE hiện chưa có dashboard aggregate API.

## 9.1. Admin lấy số liệu tổng quan

Trạng thái: `Cần bổ sung`

```http
GET /api/admin/dashboard/summary?semester=20252
```

Mục đích: Trang tổng quan admin.

Response:

```json
{
  "activeSessions": 1,
  "totalStudents": 18230,
  "totalCourses": 412,
  "totalClassSections": 1240,
  "pendingPrewarm": 2,
  "failedPrewarm": 0,
  "registeredToday": 4820,
  "cancelledToday": 312,
  "onlineOperators": 6
}
```

## 9.2. Admin lấy metrics phiên đăng ký

Trạng thái: `Cần bổ sung`

```http
GET /api/admin/dashboard/registration-metrics?semester=20252
```

Response:

```json
{
  "activeSession": {
    "id": "uuid-session",
    "name": "Đăng ký học phần kỳ 20252",
    "semester": "20252",
    "openAt": "2026-05-18T01:00:00.000Z",
    "closeAt": "2026-05-25T10:00:00.000Z",
    "status": "RUNNING"
  },
  "registeredStudents": 12480,
  "estimatedStudents": 18230,
  "successRate": 96.4,
  "conflictCount": 312,
  "averageBatchProcessMs": 1800
}
```

## 9.3. Admin lấy cảnh báo hệ thống

Trạng thái: `Cần bổ sung`

```http
GET /api/admin/dashboard/alerts
```

Response:

```json
{
  "items": [
    {
      "id": "alert-1",
      "severity": "ERROR",
      "title": "Job prewarm lỗi",
      "message": "Lỗi kết nối Redis",
      "createdAt": "2026-05-18T00:31:00.000Z"
    }
  ]
}
```

---

# 10. Settings Module

BE hiện chưa có settings API/model riêng.

## 10.1. Admin lấy cấu hình hệ thống

Trạng thái: `Cần bổ sung`

```http
GET /api/settings
```

Mục đích: Trang `AdminSettings.tsx`.

Response:

```json
{
  "currentSemester": "20252",
  "semesterStart": "2026-02-17",
  "semesterEnd": "2026-06-30",
  "maxCreditsPerSemester": 24,
  "gpaScale": "4",
  "allowCrossYearRegistration": true
}
```

## 10.2. Admin cập nhật cấu hình hệ thống

Trạng thái: `Cần bổ sung`

```http
PATCH /api/settings
```

Request:

```json
{
  "currentSemester": "20252",
  "semesterStart": "2026-02-17",
  "semesterEnd": "2026-06-30",
  "maxCreditsPerSemester": 24,
  "gpaScale": "4",
  "allowCrossYearRegistration": true
}
```

Response:

```json
{
  "currentSemester": "20252",
  "semesterStart": "2026-02-17",
  "semesterEnd": "2026-06-30",
  "maxCreditsPerSemester": 24,
  "gpaScale": "4",
  "allowCrossYearRegistration": true
}
```

---

# 11. Thứ Tự Ưu Tiên Triển Khai

## P0 - Nối flow sinh viên chạy thật

1. Auth: `login`, `me`, `logout`
2. Courses: list/detail
3. ClassSections: list/detail
4. RegistrationSessions: current session/status
5. Registrations: my, create batch, cancel batch, batch detail polling

## P1 - Admin vận hành dữ liệu lõi

1. Users CRUD/import
2. Courses CRUD/import
3. ClassSections CRUD/import/bulk status
4. RegistrationSessions CRUD
5. RegistrationSlots CRUD
6. Admin dashboard summary

## P2 - Module mở rộng

1. Grades API
2. Prewarm admin API
3. Settings API

---

# 12. Ghi Chú Khi Sửa FE

FE nên tạo lớp API client riêng, ví dụ:

```text
src/app/api/http.ts
src/app/api/authApi.ts
src/app/api/coursesApi.ts
src/app/api/classSectionsApi.ts
src/app/api/registrationsApi.ts
src/app/api/adminApi.ts
```

State cần chuyển từ mock sang API:

- `auth.tsx`: lưu `accessToken`, gọi `/api/auth/login`, `/api/auth/me`.
- `registrationStore.tsx`: gọi `/api/registrations/my`, `/api/registrations/batches`, `/api/registrations/batches/:batchId`.
- Các page tra cứu: gọi `/api/courses` và `/api/class-sections`.
- Admin pages: gọi API theo module tương ứng.

