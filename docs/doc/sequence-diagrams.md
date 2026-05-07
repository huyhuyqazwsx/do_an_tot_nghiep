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

SV -> FE : Chọn danh sách lớp + nhấn Đăng ký

FE -> FE : Check trùng lịch local\n(dùng TKB từ localStorage)\nCheck không có batch PENDING

alt Trùng lịch / có batch đang chờ
    FE --> SV : Báo lỗi ngay, không gửi request
else OK
    FE -> API : POST /api/registrations/batches\n{ semester, classSectionIds: [...] }\nAuthorization: Bearer <token>

    API -> API : Verify JWT (in-memory)
    API -> DB : Check batch PENDING/PROCESSING tồn tại?
    DB --> API : Không có

    API -> DB : Load & validate classSections\n(kiểm tra semester, status, requiresLab)
    DB --> API : Sections hợp lệ

    group DB Transaction
        API -> DB : CREATE RegistrationBatch (PENDING)
        API -> DB : CREATE RegistrationBatchItem (PENDING) × n
    end

    API -> MQ : Publish REGISTRATION_CREATE_BATCH_REQUESTED\n{ batchId, userId, semester, items[] }
    MQ --> API : ack

    API --> FE : 201 Created { batchId, status: PENDING, items[] }
    FE --> SV : "Đang xử lý..."

    == Xử lý bất đồng bộ (Worker) ==

    MQ -> Worker : Consume message
    Worker -> DB : Load active registrations của user (từ RegistrationBatchItem SUCCESS+CREATE)

    loop Với từng item
        Worker -> Worker : Validate trùng môn, trùng lịch, tiên quyết

        alt Không pass validate
            Worker -> DB : UPDATE item → FAILED (reason)
        else Pass
            group DB Transaction
                Worker -> DB : UPDATE class_sections SET sl_dk+1\nWHERE sl_dk < sl_max RETURNING remaining
                alt Hết slot
                    Worker -> DB : ROLLBACK
                    Worker -> DB : UPDATE item → FAILED "Hết chỗ"
                else Còn slot
                    Worker -> DB : INSERT outbox (REGISTRATION_SUCCESS)
                    Worker -> DB : UPDATE item → SUCCESS + remainingSlots
                end
            end
            Worker -> Redis : DEL userRegistered, userSchedule, sectionSlots, sectionInfo
        end
    end

    Worker -> DB : UPDATE batch → COMPLETED
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

## 4. Đăng ký tín chỉ — Batch hủy đăng ký

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

FE -> API : DELETE /api/registrations/batches\n{ classSectionIds: [...] }\nAuthorization: Bearer <token>

API -> API : Verify JWT
API -> DB : Load classSections, xác nhận cùng semester
DB --> API : Sections hợp lệ
API -> DB : Check RegistrationBatchItem SUCCESS+CREATE (xác nhận đang đăng ký)
DB --> API : Đang ACTIVE
API -> DB : Check không có cancel batch PENDING

group DB Transaction
    API -> DB : CREATE RegistrationBatch (CANCEL, PENDING)
    API -> DB : CREATE RegistrationBatchItem (PENDING) × n
end

API -> MQ : Publish REGISTRATION_CANCEL_BATCH_REQUESTED\n{ batchId, userId, semester }
MQ --> API : ack
API --> FE : 201 Created { batchId, status: PENDING }
FE --> SV : "Đang xử lý..."

== Xử lý bất đồng bộ (Worker) ==

MQ -> Worker : Consume message

loop Với từng item
    group DB Transaction
        Worker -> DB : findFirst RegistrationBatchItem\nWHERE classSectionId = ? AND userId = ? AND status = SUCCESS
        alt latest item type = CANCEL (idempotent)
            Worker -> DB : UPDATE item → SUCCESS
        else latest item type = CREATE
            Worker -> DB : UPDATE class_sections SET sl_dk = GREATEST(sl_dk-1, 0)
            Worker -> DB : INSERT outbox (REGISTRATION_CANCELLED)
            Worker -> DB : UPDATE item → SUCCESS + remainingSlots
        end
    end
    Worker -> Redis : DEL userRegistered, userSchedule, sectionSlots, sectionInfo
end

Worker -> DB : UPDATE batch → COMPLETED
Worker -> MQ : ack message

FE -> API : GET /api/registrations/batches/:batchId
API --> FE : batch detail
FE --> SV : Hiển thị kết quả hủy

@enduml
```

---

## 5. Prewarm Redis (Cron Job)

```plantuml
@startuml SD_Prewarm
title Sơ đồ tuần tự: Prewarm Redis (Worker Cron)

participant "Worker Cron\n(EVERY_MINUTE)" as Cron
participant "PrewarmService" as PS
database "PostgreSQL" as DB
database "Redis" as Redis

Cron -> Cron : checkAndPrewarm()\nGuard isRunning

Cron -> DB : SELECT slots WHERE prewarm_at <= now()\nAND is_prewarmed = false AND session.is_active = true
DB --> Cron : Slots cần prewarm

alt Không có slot nào
    Cron -> Cron : return (skip)
else Có slot
    loop Với từng session
        Cron -> PS : prewarmSession(session)

        PS -> Redis : SET reg:session:{semester} JSON TTL=closeAt
        PS -> DB : SELECT class_sections WHERE semester (batch 500)
        PS -> Redis : Pipeline SET reg:section:slots:{id} = sl_max - sl_dk
        PS -> Redis : Pipeline HSET reg:section:info:{id} {...}
        PS -> DB : SELECT registrations ACTIVE WHERE semester (batch 1000)
        PS -> Redis : Pipeline SADD reg:user:registered:{uid}:{semester}
        PS -> Redis : Pipeline SADD reg:user:schedule:{uid}:{semester}
        PS -> DB : SELECT users theo studentFilter trong slot
        PS -> Redis : Pipeline SADD reg:slot:allowed:{slotId} TTL=slot.closeAt
        PS -> DB : UPDATE registration_slots SET is_prewarmed=true, prewarmed_at=now()
    end
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
