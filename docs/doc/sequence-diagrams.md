# Sơ đồ tuần tự (Sequence Diagrams)

> Vẽ bằng PlantUML. Paste từng block vào https://www.plantuml.com/plantuml/uml/ để xem.

---

## 1. Đăng nhập (Login)

```plantuml
@startuml SD_Login
title Sơ đồ tuần tự: Đăng nhập

actor "Sinh viên" as SV
participant "Frontend\n(React)" as FE
participant "API Server\n(NestJS)" as API
database "PostgreSQL" as DB

SV -> FE : Nhập MSSV + mật khẩu
FE -> API : POST /api/auth/login\n{ student_id, password }

API -> DB : SELECT * FROM students\nWHERE student_id = ?
DB --> API : Thông tin sinh viên

alt Không tìm thấy tài khoản
    API --> FE : 401 Unauthorized
    FE --> SV : Hiển thị lỗi "Tài khoản không tồn tại"
else Tài khoản bị khóa
    API --> FE : 403 Forbidden
    FE --> SV : Hiển thị lỗi "Tài khoản bị khóa"
else Sai mật khẩu
    API --> FE : 401 Unauthorized
    FE --> SV : Hiển thị lỗi "Sai mật khẩu"
else Đăng nhập thành công
    API -> API : Ký JWT\n{ sub: uid, student_id, role, exp: 1h }
    API --> FE : 200 OK { accessToken }
    FE -> FE : Lưu token vào memory
    FE --> SV : Chuyển hướng vào trang đăng ký
end

@enduml
```

---

## 2. Tải TKB (Load thời khóa biểu)

```plantuml
@startuml SD_LoadTKB
title Sơ đồ tuần tự: Tải thời khóa biểu

actor "Sinh viên" as SV
participant "Frontend\n(React)" as FE
participant "API Server\n(NestJS)" as API
database "Redis" as Redis

SV -> FE : Vào trang đăng ký

FE -> FE : Đọc localStorage\nlấy tkb_version_local

FE -> API : GET /api/tkb/:semester/version
API -> Redis : GET tkb_version:{semester}
Redis --> API : "v2"
API --> FE : { version: "v2" }

alt Version khớp (tkb_version_local == "v2")
    FE -> FE : Dùng data từ localStorage
    FE --> SV : Hiển thị TKB từ cache
else Version khác hoặc chưa có cache
    FE -> API : GET /api/tkb/:semester
    API -> Redis : GET tkb:{semester}
    Redis --> API : JSON gzip key-value TKB
    API --> FE : { version: "v2", data: { "169995": {...}, ... } } ~65KB
    FE -> FE : Lưu vào localStorage\n(tkb_data + tkb_version = "v2")
    FE --> SV : Hiển thị TKB mới
end

@enduml
```

---

## 3. Đăng ký tín chỉ (Happy Path)

```plantuml
@startuml SD_DangKy
title Sơ đồ tuần tự: Đăng ký tín chỉ (Happy Path)

actor "Sinh viên" as SV
participant "Frontend\n(React)" as FE
participant "API Server\n(NestJS)" as API
participant "Redis" as Redis
participant "RabbitMQ" as MQ
participant "Worker\n(NestJS)" as Worker
database "PostgreSQL" as DB

SV -> FE : Chọn lớp + nhấn Đăng ký

FE -> FE : Check trùng lịch local\n(dùng TKB từ localStorage)

alt Trùng lịch (phát hiện local)
    FE --> SV : Báo lỗi ngay\n"Trùng lịch với lớp X"
else Không trùng
    FE -> API : POST /api/registrations\n{ maLop, maLopTN? }\nAuthorization: Bearer <token>

    API -> API : Verify JWT (in-memory)

    API -> Redis : GET reg_open:{semester}
    Redis --> API : Phiên đăng ký đang mở

    API -> Redis : SISMEMBER allowed:{slot_id} {uid}
    Redis --> API : true (SV thuộc nhóm được phép)

    API -> Redis : EXISTS registered:{uid}:{ma_lop}
    Redis --> API : false (chưa đăng ký)

    API -> Redis : SINTERSTORE schedule + new_slots
    Redis --> API : 0 (không trùng lịch)

    API -> Redis : DECR slots:{ma_lop}
    Redis --> API : 14 (còn slot)

    API -> Redis : SETNX lock:{uid}:{ma_lop} TTL 5s
    Redis --> API : 1 (lock thành công)

    API -> MQ : Publish message\n{ uid, maLop, maLopTN, jobId }
    MQ --> API : ack

    API --> FE : 202 Accepted { jobId }
    FE --> SV : "Đang xử lý..."

    == Xử lý bất đồng bộ ==

    MQ -> Worker : Consume message
    Worker -> DB : BEGIN TRANSACTION\nSELECT class_section FOR UPDATE
    Worker -> DB : Kiểm tra slot > 0
    Worker -> DB : Kiểm tra tiên quyết\n(query student_grades)
    Worker -> DB : INSERT registrations
    Worker -> DB : UPDATE class_sections SET sl_dk++
    Worker -> DB : INSERT outbox (PENDING)
    Worker -> DB : COMMIT

    Worker -> Redis : SET status:{jobId} = SUCCESS
    Worker -> Redis : SADD schedule:{uid} tiết mới
    Worker -> Redis : SET registered:{uid}:{ma_lop}
    Worker -> MQ : ack message

    == FE polling ==

    FE -> API : GET /api/registrations/status/{jobId}
    API -> Redis : GET status:{jobId}
    Redis --> API : SUCCESS
    API --> FE : { status: "SUCCESS" }
    FE --> SV : "Đăng ký thành công!"
end

@enduml
```

---

## 4. Đăng ký tín chỉ (Thất bại — hết slot)

```plantuml
@startuml SD_DangKy_HetSlot
title Sơ đồ tuần tự: Đăng ký thất bại (hết slot)

actor "Sinh viên" as SV
participant "Frontend\n(React)" as FE
participant "API Server\n(NestJS)" as API
participant "Redis" as Redis

SV -> FE : Chọn lớp + nhấn Đăng ký
FE -> API : POST /api/registrations { maLop }
API -> API : Verify JWT

API -> Redis : DECR slots:{ma_lop}
Redis --> API : -1 (hết slot)

API -> Redis : INCR slots:{ma_lop}
note right : Rollback DECR về 0

API --> FE : 409 Conflict "Lớp học đã hết chỗ"
FE --> SV : Thông báo "Lớp học đã hết chỗ"

@enduml
```

---

## 5. Hủy đăng ký

```plantuml
@startuml SD_HuyDangKy
title Sơ đồ tuần tự: Hủy đăng ký

actor "Sinh viên" as SV
participant "Frontend\n(React)" as FE
participant "API Server\n(NestJS)" as API
participant "Redis" as Redis
database "PostgreSQL" as DB

SV -> FE : Nhấn Hủy đăng ký lớp X
FE -> API : DELETE /api/registrations/:id\nAuthorization: Bearer <token>

API -> API : Verify JWT

API -> DB : SELECT registration\nWHERE id = ? AND student_id = ?
DB --> API : Thông tin đăng ký

alt Không tìm thấy hoặc không thuộc SV này
    API --> FE : 404 Not Found
    FE --> SV : Thông báo lỗi
else Phiên đăng ký đã đóng
    API --> FE : 403 Forbidden "Ngoài thời gian hủy đăng ký"
    FE --> SV : Thông báo lỗi
else Hủy thành công
    API -> DB : BEGIN TRANSACTION\nUPDATE registrations SET status = CANCELLED\nUPDATE class_sections SET sl_dk--\nCOMMIT
    API -> Redis : INCR slots:{ma_lop}
    API -> Redis : DEL registered:{uid}:{ma_lop}
    API -> Redis : SREM schedule:{uid} các tiết của lớp
    API --> FE : 200 OK
    FE --> SV : "Hủy đăng ký thành công"
end

@enduml
```

---

## 6. Pre-warm Redis (Admin mở đăng ký)

```plantuml
@startuml SD_PreWarm
title Sơ đồ tuần tự: Pre-warm Redis trước giờ mở đăng ký

actor "Admin" as Admin
participant "API Server\n(NestJS)" as API
database "PostgreSQL" as DB
participant "Redis" as Redis

Admin -> API : POST /api/admin/sessions/:id/activate

API -> DB : SELECT tất cả class_sections của kỳ
DB --> API : Danh sách lớp học phần

API -> Redis : Pipeline batch\nSET slots:{ma_lop} = sl_max - sl_dk\nHSET section:{ma_lop} thu kip tiet_bd tiet_kt...
note right : Batch toàn bộ lớp trong 1 pipeline

API -> DB : SELECT registrations ACTIVE của kỳ
DB --> API : Danh sách đăng ký hiện tại

API -> Redis : Pipeline batch\nSET registered:{uid}:{ma_lop} = "1"\nSADD schedule:{uid} tiết học
note right : Cache lịch học của tất cả SV

API -> Redis : SET tkb:{semester} = gzip(JSON key-value)
API -> Redis : SET tkb_version:{semester} = "v1"
API -> Redis : SET reg_open:{semester} = JSON phiên đăng ký

API -> DB : UPDATE registration_sessions\nSET is_active = true

API --> Admin : 200 OK "Redis sẵn sàng"
note right : Hệ thống sẵn sàng nhận 5000 request\nmà không chạm DB

@enduml
```

---

## 7. Sync snapshot Redis ↔ DB (Scheduled Job)

```plantuml
@startuml SD_Snapshot
title Sơ đồ tuần tự: Sync snapshot Redis ↔ DB (mỗi 5 phút)

participant "Scheduler\n(NestJS Cron)" as Cron
database "PostgreSQL" as DB
participant "Redis" as Redis

Cron -> DB : SELECT ma_lop, COUNT(*) as count_active\nFROM registrations\nWHERE status = 'ACTIVE'\nGROUP BY ma_lop

DB --> Cron : Danh sách { ma_lop, count_active }

loop Mỗi lớp học phần
    Cron -> DB : SELECT sl_max FROM class_sections\nWHERE ma_lop = ?
    DB --> Cron : sl_max

    Cron -> Redis : GET slots:{ma_lop}
    Redis --> Cron : redis_remaining

    Cron -> Cron : db_remaining = sl_max - count_active\nso sánh với redis_remaining

    alt Lệch nhau
        Cron -> Cron : LOG cảnh báo
        Cron -> Redis : SET slots:{ma_lop} = db_remaining
        note right : DB là nguồn sự thật
    end
end

@enduml
```

---

## 8. Gửi email thông báo (Outbox Processor)

```plantuml
@startuml SD_Outbox
title Sơ đồ tuần tự: Outbox Processor gửi email (mỗi 5 giây)

participant "Outbox Processor\n(Worker Cron)" as Cron
database "PostgreSQL" as DB
participant "SMTP Server" as SMTP

Cron -> DB : SELECT * FROM outbox\nWHERE status = 'PENDING'\nLIMIT 10

DB --> Cron : Danh sách sự kiện chờ gửi

loop Mỗi sự kiện
    Cron -> SMTP : Gửi email thông báo\n(REGISTRATION_SUCCESS / FAILED)

    alt Gửi thành công
        Cron -> DB : UPDATE outbox SET status = 'SENT'\nsent_at = NOW()
    else Gửi thất bại
        Cron -> DB : UPDATE outbox\nSET retry_count++\nstatus = 'FAILED' nếu retry >= 3\nSET error = message lỗi
    end
end

@enduml
```
