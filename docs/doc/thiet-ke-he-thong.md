# Thiết kế hệ thống đăng ký tín chỉ

> Stack: NestJS · PostgreSQL · Redis · RabbitMQ · React

---

## 1. Kiến trúc tổng quan

```text
[React - Máy Local] ──HTTP──► [API: localhost:3000]
                                    │
                            [Máy local - i5-12450H · 16GB]
                                    │
                           [PM2 Cluster - port :3000]
                    ┌───────────────┬───────────────┐
              [NestJS API #1] [NestJS API #2] [Scheduler #1]
                    └───────────────┼───────────────┘
                     ┌──────────────┴──────────────┐
                  [Redis]                     [RabbitMQ]
                                                   │
               ┌───────────┬───────────┬───────────┴───────────┬───────────┐
          [Worker #1] [Worker #2] [Worker #3] ... (8 instances) ... [Worker #8]
               └───────────┴───────────┴───────────┬───────────┴───────────┘
                                              [PostgreSQL]
```

### Các thành phần

**Frontend — React (Local)**
- Chạy môi trường phát triển local (Vite/CRA)
- Cache TKB tại browser, tự check trùng lịch local
- Sync TKB mỗi 5 phút qua ETag — chỉ nhận data mới khi có thay đổi
- Gọi trực tiếp API qua `http://localhost:3000`

**API Layer — NestJS (PM2 cluster 2 instances)**
- Stateless hoàn toàn — JWT verify in-memory, không cần Redis cho auth
- PM2 cluster: OS kernel round-robin, không cần Nginx
- Mỗi request chỉ làm: verify JWT → validate Redis → đẩy queue → trả 202
- Không chạm DB trong luồng chính khi tải cao

**Scheduler — NestJS (PM2 1 instance duy nhất)**
- Chạy các Cron jobs định kỳ
- **Prewarm Redis**: Nạp trước danh sách lớp, cấu hình cài đặt và đăng ký hiện tại vào Redis
- **Notification Cron**: Quét các batch đăng ký đã hoàn thành để gửi thông báo

**Cache — Redis**
- Validate hoàn toàn không chạm DB trong giờ cao điểm
- Pre-warm toàn bộ lớp học phần của kỳ trước khi mở đăng ký
- Snapshot sync với DB mỗi 5 phút để phát hiện và fix lệch

**Message Queue — RabbitMQ**
- Buffer hấp thụ 5000 request đồng thời
- Queue `registration_create_batch` và `registration_cancel_batch` — durable, persistent
- Dead Letter Queue cho message lỗi
- Management UI `:15672` để monitor

**Worker — NestJS Microservice (PM2 8 instances)**
- Consume từ queue, xử lý bất đồng bộ
- Xử lý business logic, lock DB, trừ/cộng slot
- Ghi log (Hash) lên Redis cho mục đích phân tích dashboard

**Database — PostgreSQL**
- Nguồn sự thật duy nhất
- Transaction ACID, `SELECT FOR UPDATE`
- PostgreSQL shared_buffer tự cache các query thường xuyên

---

## 2. Database Schema

### 2.1 Bảng users
```sql
CREATE TABLE users (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_code VARCHAR(20)  UNIQUE NOT NULL,
  name         VARCHAR(200) NOT NULL,
  email        VARCHAR(200) UNIQUE NOT NULL,
  password     VARCHAR(255) NOT NULL,
  role         VARCHAR(20)  DEFAULT 'STUDENT', -- STUDENT | ADMIN
  course_year  INTEGER,
  department   VARCHAR(100),
  is_active    BOOLEAN DEFAULT TRUE,
  created_at   TIMESTAMP DEFAULT NOW()
);
```

### 2.2 Bảng courses
```sql
CREATE TABLE courses (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code            VARCHAR(20)  UNIQUE NOT NULL,
  name            VARCHAR(300) NOT NULL,
  english_name    VARCHAR(300),
  credits         INTEGER NOT NULL,
  tuition_credits NUMERIC(5,1),
  khoi_luong      VARCHAR(20),
  department      VARCHAR(100),
  prerequisite    TEXT,
  weight          NUMERIC(3,1) DEFAULT 1
);
```

### 2.3 Bảng class_sections
```sql
CREATE TABLE class_sections (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ma_lop        VARCHAR(20)  UNIQUE NOT NULL,
  ma_lop_kem    VARCHAR(20),
  course_id     UUID REFERENCES courses(id),
  semester      VARCHAR(10)  NOT NULL,

  -- Lịch học
  thu           INTEGER,
  kip           VARCHAR(10),
  tiet_bd       INTEGER,
  tiet_kt       INTEGER,
  thoi_gian     VARCHAR(20),
  tuan          VARCHAR(50),
  phong         VARCHAR(50),

  -- Phân loại
  loai_lop      VARCHAR(20),
  dat_mo        VARCHAR(5),
  trang_thai    VARCHAR(50),
  can_tn        BOOLEAN DEFAULT FALSE,
  ghi_chu       TEXT,

  -- Slot
  sl_max        INTEGER DEFAULT 0,
  sl_dk         INTEGER DEFAULT 0,

  created_at    TIMESTAMP DEFAULT NOW()
);
```

### 2.4 Bảng registration_batches
```sql
CREATE TABLE registration_batches (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                  UUID REFERENCES users(id),
  semester                 VARCHAR(10) NOT NULL,
  type                     VARCHAR(30) NOT NULL,   -- CREATE | CANCEL
  status                   VARCHAR(30) NOT NULL,   -- PENDING | COMPLETED
  total_items              INTEGER NOT NULL,
  notification_status      VARCHAR(20) DEFAULT 'PENDING', -- PENDING | SENT | FAILED
  notification_sent_at     TIMESTAMP,
  notification_retry_count INTEGER DEFAULT 0,
  notification_error       TEXT,
  created_at               TIMESTAMP DEFAULT NOW(),
  processed_at             TIMESTAMP
);
```

**Ghi chú:** Trạng thái `notification_status` dùng để Worker/Cron quét và gửi email thông báo sau khi batch đã hoàn tất (`COMPLETED`).

### 2.4b Bảng registration_batch_items
```sql
CREATE TABLE registration_batch_items (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id         UUID REFERENCES registration_batches(id),
  class_section_id UUID REFERENCES class_sections(id),
  status           VARCHAR(30) NOT NULL,  -- PENDING | SUCCESS | FAILED | CANCELLED
  failure_reason   TEXT,
  remaining_slots  INTEGER,
  created_at       TIMESTAMP DEFAULT NOW(),
  processed_at     TIMESTAMP
);
```

### 2.5 Bảng student_grades
```sql
CREATE TABLE student_grades (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID REFERENCES users(id),
  course_id     UUID REFERENCES courses(id),
  semester      VARCHAR(10) NOT NULL,
  grade_letter  VARCHAR(2)  NOT NULL,
  grade_point   NUMERIC(3,1),
  grade_number  NUMERIC(4,1),
  created_at    TIMESTAMP DEFAULT NOW(),
  UNIQUE (user_id, course_id, semester)
);
```

### 2.6 Bảng system_settings (Singleton)
```sql
CREATE TABLE system_settings (
  id                       INTEGER PRIMARY KEY DEFAULT 1,
  current_semester         VARCHAR(10) NOT NULL,
  semester_start_date      VARCHAR(20) NOT NULL,
  semester_end_date        VARCHAR(20) NOT NULL,
  registration_open_at     TIMESTAMP NOT NULL,
  registration_close_at    TIMESTAMP NOT NULL,
  max_credits_per_semester INTEGER NOT NULL,
  updated_at               TIMESTAMP
);
```

### 2.7 Bảng registration_slots (Khung giờ đăng ký)
```sql
CREATE TABLE registration_slots (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  semester          VARCHAR(10) NOT NULL,
  name              VARCHAR(100),
  student_code_from VARCHAR(20) NOT NULL,
  student_code_to   VARCHAR(20) NOT NULL,
  start_date        VARCHAR(10) NOT NULL, -- YYYY-MM-DD
  end_date          VARCHAR(10) NOT NULL, -- YYYY-MM-DD
  start_time        VARCHAR(5) NOT NULL,  -- HH:mm
  end_time          VARCHAR(5) NOT NULL,  -- HH:mm
  created_at        TIMESTAMP DEFAULT NOW()
);
```

---

## 3. Redis Keys

| Key | Kiểu | Giá trị | TTL | Mục đích |
|---|---|---|---|---|
| `reg:settings` | String | JSON | | Singleton settings |
| `reg:slots:{semester}` | String | JSON | 30p | Danh sách slots đăng ký |
| `reg:section:slots:{id}` | String | int | 30p | Slot trống thực tế (atomic DECR/INCR) |
| `reg:section:code:{sem}:{code}`| String | JSON | 30p | Kết quả tra cứu theo mã lớp |
| `batch:log:{semester}:{id}` | Hash | fields | 10p | Metric cho 1 batch để vẽ biểu đồ |

---

## 4. Các Flow chính

### 4.1 Flow Pre-warm Redis (trước giờ mở đăng ký)

```text
Worker Cron (Scheduler app) chạy mỗi phút
        │
        ▼
Lấy cấu hình hiện tại từ system_settings
Nếu đang trong giờ đăng ký → Load danh sách class_sections từ DB
        │
        ▼
Cache số lượng slot trống:
  SET reg:section:slots:{id} = maxCapacity - registeredCount
        │
        ▼
Cache lookup môn học:
  SET reg:section:code:{sem}:{code} = JSON([...rows])
        │
        ▼
Redis sẵn sàng nhận request tốc độ cao.
```

### 4.2 Flow đăng ký tín chỉ (batch)

```text
Sinh viên chọn danh sách lớp → POST /api/registrations/batches
Body: { semester, sectionCodes: ["169995", "169996"] }
        │
        ▼
[FE - trước khi gửi request]
  Check trùng lịch local, trùng môn local.
  Nếu OK → gửi request.
        │
        ▼
[BE - NestJS API (do-an)]
1. Verify JWT (in-memory)
2. Check không có batch PENDING cho kỳ này.
3. Validate: Lớp đang mở, chưa đầy (Redis fast-fail: DECRBY 1).
4. Lưu RegistrationBatch và Items vào DB với trạng thái PENDING.
        │
        ▼
Publish vào RabbitMQ (REGISTRATION_CREATE_BATCH_REQUESTED)
Trả về 201 + batchId
        │
        ▼
[Worker]
Consume queue.
Mở Transaction:
  UPDATE class_sections SET sl_dk = sl_dk + 1 WHERE sl_dk < sl_max
  Nếu thành công:
    UPDATE Item status = SUCCESS
  Nếu thất bại (hết slot, lỗi):
    UPDATE Item status = FAILED
Cập nhật Batch status = COMPLETED.
Ghi Hash batch:log vào Redis.
ACK message.
```

### 4.3 Flow Gửi Email Thông báo (Notification Cron)

```text
Scheduler Cron chạy mỗi phút:
        │
        ▼
Tìm các RegistrationBatch có:
  status = COMPLETED
  notification_status = PENDING
        │
        ▼
Gửi Email tổng hợp kết quả các items trong Batch.
Cập nhật notification_status = SENT (hoặc FAILED nếu gửi lỗi).
```
```

---

## 5. Cơ chế chịu lỗi (Fault Tolerance) & Toàn vẹn dữ liệu

Hệ thống được thiết kế để tự phục hồi và bảo toàn dữ liệu ngay cả khi hạ tầng (Redis, RabbitMQ) gặp sự cố tắt đột ngột (Crash/Restart).

### 5.1 Persistence cho Middleware (Docker Compose)
* **Redis (Append Only File - AOF):** Cấu hình `redis-server --appendonly yes` đảm bảo mọi lệnh Ghi đều được append xuống ổ cứng. Khi container restart, Redis sẽ đọc lại file AOF để khôi phục dữ liệu đăng ký (slots/metrics).
* **RabbitMQ (Durable & Persistent):** Các Queue đăng ký (`registration_create_batch`, `registration_cancel_batch`) đều được cấu hình `durable: true`, và message gửi đi có thuộc tính `persistent`. Khi thỏ (RabbitMQ) bị chết, message đang xếp hàng chưa kịp xử lý vẫn nằm an toàn trên ổ cứng và tự phục hồi khi hệ thống lên lại.

### 5.2 Auto-Healing Cache (Phục hồi Redis tự động)
Trong Service `PrewarmService` (chạy trên Scheduler app), hàm `healIfNeeded()` hoạt động định kỳ mỗi phút:
* Kiểm tra hệ thống có đang trong thời gian mở đăng ký hay không (đọc từ Postgres `system_settings`).
* Dùng lệnh `EXISTS reg:section:slots:{id}` để kiểm tra thử một lớp học phần bất kỳ.
* **Nếu Miss (Redis mất dữ liệu do sự cố hoặc hết TTL):** Hệ thống sẽ cảnh báo `[Prewarm] Redis MISS ... auto-healing...` và lập tức nạp lại toàn bộ dữ liệu cấu hình, số lượng slot và chi tiết môn học từ DB lên Redis. Điều này đảm bảo Redis luôn ở trạng thái sẵn sàng phục vụ Luồng Đọc.

### 5.3 Cơ chế Reconcile (Sửa lỗi sai lệch Slot)
Bên cạnh Auto-Healing, `PrewarmService` còn có hàm `reconcileCurrentSemesterSlots()` chạy ngầm (Cronjob):
* **Hoạt động:** Đọc danh sách toàn bộ các lớp của học kỳ hiện tại từ DB (PostgreSQL) và dùng lệnh `MGET` để quét một lượt toàn bộ số lượng slot đang lưu trên Redis.
* **Xử lý:** Nó so sánh logic `sl_max - sl_dk` (từ DB) với dữ liệu đếm trên Redis. Nếu phát hiện lệch số do thao tác `DECR` bị hụt mạng hoặc rớt gói tin, nó sẽ mở `Pipeline` ghi đè (fix) lại giá trị đúng đắn lên Redis một cách đồng loạt.

---

## 6. Cấu trúc project (NestJS Monorepo)

```text
apps/
  do-an/src/             ← API Gateway (HTTP REST)
    modules/
      auth/
      users/
      courses/
      class-sections/
      registrations/
      registration-slots/
      settings/
      dashboard/

  worker/src/             ← Background Workers (RabbitMQ Consumer)
    registration/
      create-batch.handler.ts
      cancel-batch.handler.ts

  scheduler/src/          ← Singleton Cronjobs
    prewarm/
    notification/

libs/
  shared/src/
    prisma/                  ← Prisma ORM
    redis/                   ← Caching & Configs
    rabbitmq/                ← Pub/Sub
    auth/                    ← JWT, Guards
```

---

## 7. Khởi động hệ thống

```bash
# Hạ tầng
docker compose up -d

# Build
npm run build

# Chạy với PM2 (2 API, 8 Worker, 1 Scheduler)
pm2 start ecosystem.config.js

# Load test
k6 run scripts/k6/registration-batch.js
```
