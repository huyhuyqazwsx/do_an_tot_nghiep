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
FE -> API : POST /api/auth/login\n{ studentCode, password }

API -> DB : SELECT * FROM users\nWHERE student_code = ?
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
    API -> API : Ký JWT\n{ sub: uid, studentCode, role, exp: 1h }
    API --> FE : 200 OK { accessToken }
    FE -> FE : Lưu token vào memory
    FE --> SV : Chuyển hướng vào trang đăng ký
end

@enduml
```

---

## 2. Đăng ký tín chỉ (Happy Path)

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

SV -> FE : Chọn danh sách lớp + nhấn Đăng ký

FE -> FE : Check trùng lịch local\nCheck không có batch PENDING

alt Trùng lịch / có batch đang chờ
    FE --> SV : Báo lỗi ngay, không gửi request
else OK
    FE -> API : POST /api/registrations/batches\n{ semester, sectionCodes: [...] }\nAuthorization: Bearer <token>

    API -> API : Verify JWT (in-memory)
    API -> DB : Check batch PENDING tồn tại?
    DB --> API : Không có

    API -> DB : Load & validate classSections\n(kiểm tra semester, status, requiresLab)
    DB --> API : Sections hợp lệ

    group DB Transaction
        API -> DB : CREATE RegistrationBatch (PENDING)
        API -> DB : CREATE RegistrationBatchItem (PENDING) × n
    end

    API -> MQ : Publish REGISTRATION_CREATE_BATCH_REQUESTED
    MQ --> API : ack

    API --> FE : 201 Created { batchId, status: PENDING, items[] }
    FE --> SV : "Đang xử lý..."

    == Xử lý bất đồng bộ (Worker) ==

    MQ -> Worker : Consume message
    Worker -> DB : Load items PENDING thuộc Batch

    loop Với từng item
        Worker -> Worker : Acquire slot lock

        group DB Transaction
            Worker -> DB : UPDATE class_sections SET sl_dk+1\nWHERE sl_dk < sl_max RETURNING remaining
            alt Hết slot
                Worker -> DB : ROLLBACK
                Worker -> DB : UPDATE item → FAILED "Hết chỗ"
            else Còn slot
                Worker -> DB : UPDATE item → SUCCESS + remainingSlots
            end
        end
    end

    Worker -> DB : UPDATE batch → COMPLETED (notification_status=PENDING)
    Worker -> Redis : Log thông tin Batch (Hash) dùng cho Dashboard
    Worker -> MQ : ack message

    == FE polling ==

    FE -> API : GET /api/registrations/batches/:batchId
    API -> DB : findFirst batch WHERE userId match
    DB --> API : batch { items[{ status, failureReason }] }
    API --> FE : batch detail
    FE --> SV : ✅ Thành công | ❌ Thất bại + lý do | ⏳ Đang xử lý
end

@enduml
```

---

## 3. Đăng ký tín chỉ — Batch hủy đăng ký

```plantuml
@startuml SD_CancelBatch
title Sơ đồ tuần tự: Hủy đăng ký (Cancel Batch)

actor "Sinh viên" as SV
participant "Frontend\n(React)" as FE
participant "API Server\n(NestJS)" as API
participant "RabbitMQ" as MQ
participant "Worker\n(NestJS)" as Worker
database "PostgreSQL" as DB
participant "Redis" as Redis

SV -> FE : Chọn các lớp cần hủy

FE -> API : DELETE /api/registrations/batches\n{ sectionCodes: [...] }\nAuthorization: Bearer <token>

API -> API : Verify JWT
API -> DB : Check RegistrationBatchItem SUCCESS+CREATE (xác nhận đang đăng ký)
DB --> API : Đang ACTIVE
API -> DB : Check không có cancel batch PENDING

group DB Transaction
    API -> DB : CREATE RegistrationBatch (CANCEL, PENDING)
    API -> DB : CREATE RegistrationBatchItem (PENDING) × n
end

API -> MQ : Publish REGISTRATION_CANCEL_BATCH_REQUESTED
MQ --> API : ack
API --> FE : 201 Created { batchId, status: PENDING }
FE --> SV : "Đang xử lý..."

== Xử lý bất đồng bộ (Worker) ==

MQ -> Worker : Consume message

loop Với từng item
    group DB Transaction
        Worker -> DB : findFirst RegistrationBatchItem SUCCESS
        Worker -> DB : UPDATE class_sections SET sl_dk = GREATEST(sl_dk-1, 0)
        Worker -> DB : UPDATE item → CANCELLED + remainingSlots
    end
end

Worker -> DB : UPDATE batch → COMPLETED (notification_status=PENDING)
Worker -> Redis : Log thông tin Batch
Worker -> MQ : ack message

@enduml
```

---

## 4. Prewarm Redis (Scheduler Cron)

```plantuml
@startuml SD_Prewarm
title Sơ đồ tuần tự: Prewarm Redis (Scheduler Cron)

participant "Scheduler Cron\n(EVERY_MINUTE)" as Cron
participant "PrewarmService" as PS
database "PostgreSQL" as DB
database "Redis" as Redis

Cron -> DB : SELECT * FROM system_settings WHERE id=1
DB --> Cron : Settings

alt Hiện đang trong window đăng ký?
    Cron -> Cron : healIfNeeded()

    Cron -> PS : prewarmSemester(semester)
    
    PS -> DB : SELECT * FROM class_sections WHERE semester
    DB --> PS : Danh sách lớp
    
    PS -> Redis : Pipeline SET reg:section:slots:{id} = max - registered
    PS -> Redis : Pipeline SET reg:section:code:{sem}:{code} = JSON
    PS -> Redis : EXEC pipeline
end

@enduml
```

---

## 5. Gửi email thông báo (Notification Cron)

```plantuml
@startuml SD_Notification
title Sơ đồ tuần tự: Notification Cron gửi email (Scheduler, mỗi phút)

participant "Notification Cron\n(Scheduler)" as Cron
database "PostgreSQL" as DB
participant "SMTP Server" as SMTP

Cron -> DB : SELECT * FROM registration_batches\nWHERE notification_status = 'PENDING' AND status = 'COMPLETED'\nLIMIT 50

DB --> Cron : Danh sách Batches chờ gửi thông báo

loop Mỗi Batch
    Cron -> DB : SELECT items thuộc batch
    Cron -> SMTP : Gửi email thông báo kết quả (SUCCESS/FAILED/CANCELLED)

    alt Gửi thành công
        Cron -> DB : UPDATE registration_batches\nSET notification_status = 'SENT', notification_sent_at = NOW()
    else Gửi thất bại
        Cron -> DB : UPDATE registration_batches\nSET notification_retry_count = notification_retry_count + 1,\nnotification_error = message lỗi\n(Nếu retry > 3 thì set notification_status = 'FAILED')
    end
end

@enduml
```
