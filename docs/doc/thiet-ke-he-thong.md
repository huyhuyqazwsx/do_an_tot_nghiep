# Thiết kế hệ thống đăng ký tín chỉ

> Stack: NestJS · PostgreSQL · Redis · RabbitMQ · React · Vercel · Ngrok

---

## 1. Kiến trúc tổng quan

```
[React - Vercel] ──HTTPS──► [Ngrok Tunnel]
                                    │
                            [Máy local - i5-12450H · 16GB]
                                    │
                          [PM2 Cluster - port :3000]
                    ┌─────────────┬─────────────┐
              [NestJS #1]   [NestJS #2]   [NestJS #3]
                    └─────────────┼─────────────┘
                     ┌────────────┴────────────┐
                  [Redis]               [RabbitMQ]
                                             │
                                 ┌───────────┴───────────┐
                            [Worker #1]           [Worker #2]
                                 └───────────┬───────────┘
                                       [PostgreSQL]
```

### Các thành phần

**Frontend — React (Vercel)**
- Build tĩnh, Vercel serve qua CDN
- Cache TKB tại browser, tự check trùng lịch local
- Sync TKB mỗi 5 phút qua ETag — chỉ nhận data mới khi có thay đổi
- Gọi API qua Ngrok tunnel URL cố định

**Tunnel — Ngrok**
- URL cố định `nodal-overlusciously-kimberlie.ngrok-free.dev`
- Free tier, không cần IP tĩnh hay mở port router
- Chỉ dùng cho traffic thật (không dùng cho load test)

**API Layer — NestJS (PM2 cluster 3 instance)**
- Stateless hoàn toàn — JWT verify in-memory, không cần Redis cho auth
- PM2 cluster: OS kernel round-robin, không cần Nginx
- Mỗi request chỉ làm: verify JWT → validate Redis → đẩy queue → trả 202
- Không chạm DB trong luồng chính

**Cache — Redis**
- Validate hoàn toàn không chạm DB trong giờ cao điểm
- Pre-warm toàn bộ lớp học phần của kỳ trước khi mở đăng ký
- Snapshot sync với DB mỗi 5 phút để phát hiện và fix lệch
- Giai đoạn đầu cache toàn bộ, sau tối ưu theo kíp + cache miss

**Message Queue — RabbitMQ**
- Buffer hấp thụ 5000 request đồng thời
- `registration.queue` — durable, persistent
- Dead Letter Queue cho message lỗi
- Management UI `:15672` để monitor

**Worker — NestJS Microservice (PM2 2 instance)**
- Consume từ queue, prefetch=10
- Xử lý business logic, ghi DB
- Ghi kết quả vào Redis để client polling

**Database — PostgreSQL**
- Nguồn sự thật duy nhất
- Transaction ACID, `SELECT FOR UPDATE`
- PostgreSQL shared_buffer tự cache các query thường xuyên

---

## 2. Database Schema

### 2.1 Bảng students
```sql
CREATE TABLE students (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id    VARCHAR(20)  UNIQUE NOT NULL,  -- 20215678
  name          VARCHAR(200) NOT NULL,
  email         VARCHAR(200) UNIQUE NOT NULL,
  password      VARCHAR(255) NOT NULL,
  program       VARCHAR(5)   NOT NULL,         -- A | B | AB
  course_year   INTEGER,                       -- 2021 → K66
  department    VARCHAR(100),
  is_active     BOOLEAN DEFAULT TRUE,
  created_at    TIMESTAMP DEFAULT NOW()
);
```

**Ghi chú:** `program` dùng để phân nhóm đăng ký theo khung giờ (A/B/AB).

### 2.2 Bảng courses
```sql
CREATE TABLE courses (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code          VARCHAR(20)  UNIQUE NOT NULL,  -- AC2070
  name          VARCHAR(300) NOT NULL,
  english_name  VARCHAR(300),
  credits       INTEGER NOT NULL,
  khoi_luong    VARCHAR(20),                   -- 3(2-1-1-6)
  department    VARCHAR(100),
  prerequisite  VARCHAR(20),                   -- mã môn tiên quyết
  weight        INTEGER DEFAULT 1
);
```

### 2.3 Bảng class_sections
```sql
CREATE TABLE class_sections (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ma_lop        VARCHAR(20)  UNIQUE NOT NULL,  -- 169995
  ma_lop_kem    VARCHAR(20),                   -- lớp kèm (BT/TN đi kèm)
  course_id     UUID REFERENCES courses(id),
  semester      VARCHAR(10)  NOT NULL,         -- 20252

  -- Lịch học
  thu           INTEGER,                       -- 2-7
  kip           VARCHAR(10),                   -- Sáng | Chiều | Tối
  tiet_bd       INTEGER,                       -- tiết bắt đầu 1-6
  tiet_kt       INTEGER,                       -- tiết kết thúc 1-6
  thoi_gian     VARCHAR(20),                   -- 0645-0910 (raw TKB)
  tuan          VARCHAR(50),                   -- 25-32,34-42
  phong         VARCHAR(50),

  -- Phân loại
  loai_lop      VARCHAR(20),
  -- LT+BT | TN | ĐA | TT | ĐATN | TTTN | TTKT | TTKS | ĐATNKS | BT | LT | TH
  dat_mo        VARCHAR(5),                    -- A | B | AB
  trang_thai    VARCHAR(50),
  -- Điều chỉnh ĐK | Hủy lớp | Kết thúc ĐK | Đang xếp TKB
  can_tn        BOOLEAN DEFAULT FALSE,
  ghi_chu       TEXT,

  -- Slot
  sl_max        INTEGER DEFAULT 0,
  sl_dk         INTEGER DEFAULT 0,

  created_at    TIMESTAMP DEFAULT NOW()
);
```

**Ghi chú về kíp:**
- Mỗi tiết = 45 phút
- Sáng 6 tiết: tiết 1 (06:45) → tiết 6 (11:45)
- Chiều 6 tiết: tiết 1 (12:30) → tiết 6 (17:30)
- `tiet_bd` và `tiet_kt` dùng để check overlap lịch

**Ghi chú về loại lớp:**
- Nhiều môn có cả lớp `LT+BT` lẫn `TN` — sinh viên cần đăng ký cả 2
- `ma_lop_kem` liên kết lớp TN với lớp LT+BT tương ứng

### 2.4 Bảng registrations
```sql
CREATE TABLE registrations (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id        UUID REFERENCES students(id),
  class_section_id  UUID REFERENCES class_sections(id),
  status            VARCHAR(20) DEFAULT 'ACTIVE',
  -- ACTIVE | CANCELLED | PENDING
  registered_at     TIMESTAMP DEFAULT NOW(),
  cancelled_at      TIMESTAMP,
  UNIQUE (student_id, class_section_id)
);
```

### 2.5 Bảng student_grades
```sql
CREATE TABLE student_grades (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id    UUID REFERENCES students(id),
  course_id     UUID REFERENCES courses(id),
  semester      VARCHAR(10) NOT NULL,

  grade_letter  VARCHAR(2)  NOT NULL,   -- A | B+ | B | C+ | C | D+ | D | F
  grade_point   NUMERIC(3,1),           -- 4.0 | 3.5 | 3.0 | ...
  grade_number  NUMERIC(4,1),           -- điểm số 0-10

  created_at    TIMESTAMP DEFAULT NOW(),
  UNIQUE (student_id, course_id, semester)
);
```

**Ghi chú:** Lưu dạng snapshot — học lại nhiều lần = nhiều bản ghi. Validate tiên quyết chỉ cần check tồn tại ít nhất 1 bản ghi `grade_letter != 'F'`.

### 2.6 Bảng outbox
```sql
CREATE TABLE outbox (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type    VARCHAR(50) NOT NULL,
  -- REGISTRATION_SUCCESS | REGISTRATION_FAILED | REGISTRATION_CANCELLED
  payload       JSONB NOT NULL,
  -- { studentId, studentEmail, studentName, courseName, maLop, semester }
  status        VARCHAR(20) DEFAULT 'PENDING',
  -- PENDING | SENT | FAILED
  retry_count   INTEGER DEFAULT 0,
  created_at    TIMESTAMP DEFAULT NOW(),
  sent_at       TIMESTAMP,
  error         TEXT
);
```

**Ghi chú:** Outbox nằm trong cùng transaction với đăng ký — đảm bảo atomic: đăng ký thành công thì chắc chắn có email, không bao giờ gửi email khi đăng ký thất bại.

### 2.7 Bảng registration_sessions
```sql
CREATE TABLE registration_sessions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  semester      VARCHAR(10)  NOT NULL,
  name          VARCHAR(100),              -- "Đợt 1 - K66"
  open_at       TIMESTAMP    NOT NULL,
  close_at      TIMESTAMP    NOT NULL,
  is_active     BOOLEAN DEFAULT FALSE,
  created_at    TIMESTAMP DEFAULT NOW()
);
```

### 2.8 Bảng registration_slots (phân khung giờ)
```sql
CREATE TABLE registration_slots (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id      UUID REFERENCES registration_sessions(id),
  name            VARCHAR(100),            -- "K66 - ELITECH - Đợt 1"
  student_filter  JSONB NOT NULL,
  -- { course_year: 2021, program: "A" }
  -- { department: "CNTT" }
  open_at         TIMESTAMP NOT NULL,
  close_at        TIMESTAMP NOT NULL,
  prewarm_at      TIMESTAMP NOT NULL,      -- thường = open_at - 15 phút
  is_prewarmed    BOOLEAN DEFAULT FALSE,
  prewarmed_at    TIMESTAMP,
  created_at      TIMESTAMP DEFAULT NOW()
);
```

### 2.9 Indexes
```sql
CREATE INDEX idx_class_sections_course    ON class_sections(course_id);
CREATE INDEX idx_class_sections_semester  ON class_sections(semester);
CREATE INDEX idx_class_sections_ma_lop    ON class_sections(ma_lop);
CREATE INDEX idx_registrations_student    ON registrations(student_id);
CREATE INDEX idx_registrations_section    ON registrations(class_section_id);
CREATE INDEX idx_registrations_status     ON registrations(status);
CREATE INDEX idx_grades_student_course    ON student_grades(student_id, course_id);
CREATE INDEX idx_outbox_status            ON outbox(status);
CREATE INDEX idx_outbox_created           ON outbox(created_at);
```

---

## 3. Redis Keys

| Key | Kiểu | Giá trị | TTL | Mục đích |
|---|---|---|---|---|
| `slots:{ma_lop}` | String | số nguyên | không hết hạn | Slot còn lại, DECR atomic |
| `lock:{uid}:{ma_lop}` | String | "1" | 5 giây | Chống double submit |
| `registered:{uid}:{ma_lop}` | String | "1" | hết đăng ký | Check đã đăng ký chưa |
| `schedule:{uid}` | Set | "3:Sáng:1", "3:Sáng:2"... | hết đăng ký | Lịch hiện tại của SV |
| `section:{ma_lop}` | Hash | thu, kip, tiet_bd, tiet_kt... | 1 giờ | Thông tin lớp |
| `tkb:{semester}` | String | JSON gzip key-value object TKB | không hết hạn | TKB cho FE cache local |
| `tkb_version:{semester}` | String | "v1", "v2"... | không hết hạn | FE so sánh với localStorage để biết có cần tải lại không |
| `reg_open:{semester}` | String | JSON | 24 giờ | Phiên đăng ký đang mở |
| `allowed:{slot_id}` | Set | danh sách uid | hết slot | SV được phép vào khung giờ |
| `status:{job_id}` | String | PENDING/SUCCESS/FAILED | 1 giờ | Kết quả để client polling |

### Chiến lược cache

**Giai đoạn hiện tại — cache toàn bộ:**
- Pre-warm duyệt qua tất cả lớp của kỳ, SET từng key `slots:{ma_lop}` và `section:{ma_lop}`
- Cache toàn bộ TKB vào 1 key `tkb:{semester}` dạng key-value object (nén gzip ~65KB), chỉ giữ 8 field cần thiết: `maHP`, `thu`, `kip`, `tietBd`, `tietKt`, `loaiLop`, `canTN`, `maLopKem`
- FE lưu vào localStorage kèm version, xóa khi logout

**Giai đoạn tối ưu sau:**
- Tách cache theo kíp — chỉ pre-warm kíp sắp mở
- Kết hợp cache miss — lớp chưa có trong Redis thì lazy load từ DB

**Nguyên tắc chọn kiểu cache:**

| Dữ liệu | Kiểu | Lý do |
|---|---|---|
| TKB toàn bộ | String (JSON gzip) | Đọc 1 lần toàn bộ |
| Slots còn lại | String (DECR) | Cần atomic operation |
| Registered | String (EXISTS) | Check O(1) |
| Schedule SV | Set (SISMEMBER) | Check overlap O(1) |
| Allowed SV | Set (SISMEMBER) | Check O(1) |

---

## 4. Các Flow chính

### 4.1 Flow Pre-warm Redis (trước giờ mở đăng ký)

```
Admin kích hoạt registration_session
(hoặc scheduled job chạy trước 15 phút)
        │
        ▼
Duyệt qua tất cả class_sections của kỳ học:
  ├── SET slots:{ma_lop} = sl_max - sl_dk  (Redis pipeline batch)
  └── HSET section:{ma_lop} thu kip tiet_bd tiet_kt ...
        │
        ▼
Cache toàn bộ TKB:
  SET tkb:{semester} = gzip(JSON tất cả lớp)
  SET tkb_version:{semester} = "v1"
        │
        ▼
Cache danh sách đã đăng ký (kỳ hiện tại):
  Duyệt registrations ACTIVE
  SET registered:{uid}:{ma_lop} = "1"  (pipeline batch)
        │
        ▼
Cache lịch học hiện tại của từng SV:
  Với mỗi SV có đăng ký active:
  SADD schedule:{uid} "thu:kip:tiet" cho từng tiết
        │
        ▼
SET reg_open:{semester} = JSON phiên đăng ký
        │
        ▼
UPDATE registration_sessions SET is_active = true
        │
        ▼
Redis sẵn sàng — 5000 request đến không chạm DB

Ghi chú: Giai đoạn đầu cache toàn bộ kỳ học.
Sau tối ưu: cache theo kíp + lazy load cho lớp chưa có trong Redis.
```

### 4.2 Flow đăng ký tín chỉ (happy path)

```
Sinh viên nhập mã lớp → POST /api/registrations
        │
        ▼
[FE - trước khi gửi request]
  Check trùng lịch local với TKB đã cache tại browser
  ├── Trùng → báo lỗi ngay, không gửi request (UX)
  └── Không trùng → gửi request
        │
        ▼
[BE - NestJS API]
1. Verify JWT (in-memory, không DB, không Redis)
2. Rate limit per user (Redis INCR, TTL 1s)
3. Check phiên đăng ký còn mở (Redis GET reg_open)
4. Check lớp tồn tại + SV thuộc nhóm được phép (Redis SISMEMBER allowed)
5. Check đã đăng ký chưa (Redis EXISTS registered)
6. Check trùng lịch server-side (Redis SINTERSTORE schedule + new_slots)
7. DECR slot (Redis atomic) → âm thì INCR lại + reject
8. SET lock (Redis SETNX TTL 5s) → đã có lock thì reject
        │
        ▼
Publish message → RabbitMQ
        │
        ▼
Trả về 202 Accepted + jobId (không chờ worker)
        │
        ▼
[Worker - NestJS Microservice]
BEGIN TRANSACTION
  SELECT class_section FOR UPDATE (safety net DB)
  Kiểm tra slots > 0 trong DB
  Kiểm tra tiên quyết (query student_grades)
  INSERT registrations (LT+BT)
  INSERT registrations (TN) nếu có lớp kèm
  UPDATE class_sections SET sl_dk = sl_dk + 1
  INSERT outbox (REGISTRATION_SUCCESS)
COMMIT
        │
        ▼
SET status:{jobId} = SUCCESS (Redis)
SADD schedule:{uid} các tiết mới (Redis)
SET registered:{uid}:{ma_lop} (Redis)
ack message RabbitMQ
        │
        ▼
[Outbox Processor - job mỗi 5 giây]
  SELECT * FROM outbox WHERE status = PENDING
  Gửi email thông báo qua SMTP
  UPDATE outbox SET status = SENT
        │
        ▼
[FE polling GET /api/registrations/status/:jobId]
  Nhận SUCCESS → hiển thị kết quả
```

### 4.3 Flow validate tiên quyết (trong Worker)

```
Worker nhận message đăng ký
        │
        ▼
Lấy thông tin môn học từ DB (course.prerequisite)
        │
        ├── Không có tiên quyết → tiếp tục
        │
        └── Có tiên quyết → query student_grades
              WHERE student_id = ?
              AND course_id = prerequisite_course_id
              AND grade_letter != 'F'
              LIMIT 1
                │
                ├── Tìm thấy → đã qua tiên quyết → tiếp tục
                └── Không tìm thấy → FAIL → SET status FAILED
                                          → nack → DLQ
```

### 4.4 Flow sync TKB (FE ↔ BE)

```
Admin sửa TKB → DB update
        │
        ▼
Trigger: tăng tkb_version:{semester} trong Redis
  SET tkb_version:20252 = "v2"
  SET tkb:20252 = gzip(JSON data mới)
        │
        ▼
FE load trang:
  1. Đọc localStorage: tkb_version_local = "v1"
  2. GET /api/tkb/:semester/version → { version: "v2" }
     ├── Khớp "v1" == "v1" → dùng localStorage, không download
     └── Khác "v1" != "v2" → GET /api/tkb/:semester
                            → BE trả { version: "v2", data: {...} } ~65KB gzip
                            → FE lưu lại localStorage + cập nhật version

Logout:
  FE xóa tkb_data + tkb_version khỏi localStorage
```

### 4.5 Flow Snapshot Redis ↔ DB (mỗi 5 phút)

```
Scheduled job chạy trong giờ đăng ký
        │
        ▼
Query DB: đếm registrations ACTIVE theo từng ma_lop
        │
        ▼
So sánh: DB_remaining = sl_max - count_active
         Redis_remaining = GET slots:{ma_lop}
        │
        ├── Bằng nhau → OK, không làm gì
        └── Lệch nhau → LOG cảnh báo
                      → SET slots:{ma_lop} = DB_remaining
                      → DB là nguồn sự thật
```

---

## 5. Xác thực (Authentication)

### Giai đoạn hiện tại — JWT đơn giản

```
Login:
  POST /api/auth/login { student_id, password }
  BE verify password (bcrypt)
  Ký JWT: { sub: uid, student_id, role, exp: 1h }
  Trả về accessToken

Mỗi request:
  Header: Authorization: Bearer <token>
  BE verify JWT (in-memory, không Redis, không DB)
  → Nhanh nhất, phù hợp load test k6
```

**Lưu ý với k6:**
- JWT expiry đặt `1h` khi test để không expire giữa chừng
- Seed 1000 SV → login lấy tokens → lưu `tokens.json`
- k6 dùng `SharedArray` load tokens 1 lần, 5000 VU xoay vòng

### Nâng cấp sau — Single Session (1 người 1 phiên)

```
Login mới:
  Tăng session_version:{uid} trong Redis
  Tạo JWT với payload: { ..., sessionVersion: N }

Mỗi request:
  Verify JWT → lấy sessionVersion từ token
  GET session_version:{uid} từ Redis
  Không khớp → 401 (phiên cũ bị kick tự động)
```

---

## 6. Phân chia trách nhiệm validate

| Validate | FE | BE (API) | BE (Worker) |
|---|---|---|---|
| JWT | | Bắt buộc (in-memory) | |
| Rate limit | | Redis | |
| Phiên đăng ký mở | | Redis | |
| Nhóm được phép | | Redis Set | |
| Đã đăng ký chưa | | Redis | |
| Trùng lịch | Local (UX) | Redis (bắt buộc) | |
| Slot còn không | Hiển thị (UX) | Redis DECR | DB FOR UPDATE |
| Tiên quyết | | | DB query |
| Toàn vẹn dữ liệu | | | DB transaction |

---

## 7. Outbox Pattern

```
Worker transaction (atomic):
  INSERT registrations     ─┐
  UPDATE class_sections sl  ├── Cùng 1 transaction
  INSERT outbox (PENDING)  ─┘

Outbox Processor (job độc lập):
  Poll outbox WHERE status = PENDING
  Gửi email
  UPDATE status = SENT / FAILED
  Retry tối đa 3 lần nếu FAILED
```

Đảm bảo: đăng ký thành công → chắc chắn có email. Không bao giờ gửi email khi đăng ký thất bại.

---

## 7. API Endpoints

```
Auth:
  POST   /api/auth/login
  GET    /api/auth/me

TKB:
  GET    /api/tkb/:semester            → Toàn bộ TKB kỳ học dạng key-value object (gzip ~65KB)
  GET    /api/tkb/:semester/version    → { version: "v2" } — FE check trước khi download

Môn học:
  GET    /api/courses                  → danh sách môn
  GET    /api/courses/:code/sections   → lớp của môn (kèm lớp TN)

Đăng ký:
  POST   /api/registrations            → đăng ký (vào queue)
  GET    /api/registrations/status/:jobId → polling kết quả
  GET    /api/registrations/me         → danh sách đã đăng ký
  DELETE /api/registrations/:id        → hủy đăng ký

Admin:
  POST   /api/admin/sessions           → tạo phiên đăng ký
  POST   /api/admin/sessions/:id/activate → mở đăng ký + trigger pre-warm
  POST   /api/admin/tkb/sync           → force sync TKB + tăng ETag version
```

---

## 8. Load Testing với k6

```javascript
// scripts/load-test.js
import http from 'k6/http';
import { check, sleep } from 'k6';
import { SharedArray } from 'k6/data';

// Load 1 lần, chia sẻ tất cả VU — tiết kiệm RAM
const tokens = new SharedArray('tokens', function () {
  return JSON.parse(open('./tokens.json'));
});

export const options = {
  stages: [
    { duration: '30s', target: 1000 },  // khởi động
    { duration: '2m',  target: 5000 },  // peak
    { duration: '30s', target: 0    },  // giảm tải
  ],
  thresholds: {
    http_req_duration: ['p(95)<2000'],   // 95% request < 2s
    http_req_failed:   ['rate<0.01'],    // lỗi < 1%
  },
};

export default function () {
  // 5000 VU xoay vòng 1000 token
  const token = tokens[(__VU - 1) % tokens.length];

  const res = http.post(
    'http://localhost:3000/api/registrations',
    JSON.stringify({ maLop: 'CS101' }),
    { headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
    }},
  );

  check(res, {
    'nhận 202':  (r) => r.status === 202,
    'có jobId':  (r) => r.json('jobId') !== undefined,
  });

  sleep(0.1);
}
```

**Lưu ý:**
- Chạy k6 thẳng `localhost:3000` — không qua Ngrok tunnel
- JWT expiry set `1h` trong `.env` khi test
- Seed script tạo 1000 SV + login lấy tokens trước khi test

---

## 9. Cấu trúc project (NestJS Monorepo)

```
apps/
  api/src/
    auth/
    registration/
    tkb/
    admin/
    redis/
  worker/src/
    registration/        ← @MessagePattern handler
    outbox/              ← email processor
libs/
  shared/src/
    entities/            ← TypeORM/Prisma entities
    dto/
    constants/           ← queue names, redis keys
scripts/
  seed-students.ts       ← tạo 1000 SV test
  load-test.js           ← k6 script
docker/
  docker-compose.yml     ← PostgreSQL + Redis + RabbitMQ
```

---

## 10. Khởi động hệ thống

```bash
# Hạ tầng
cd docker && docker compose up -d

# Build + chạy
npm run build
pm2 start dist/apps/api/main.js    -i 3 --name api
pm2 start dist/apps/worker/main.js -i 2 --name worker

# Tunnel
ngrok start do-an

# Load test (localhost, không qua tunnel)
k6 run scripts/load-test.js
```

---

## 11. Ước tính tài nguyên

| Service | RAM | Ghi chú |
|---|---|---|
| NestJS API × 3 | ~240MB | PM2 cluster |
| NestJS Worker × 2 | ~160MB | PM2 cluster |
| RabbitMQ | ~150MB | Docker |
| PostgreSQL | ~200MB | Docker, shared_buffer tự cache |
| Redis | ~50MB | Docker, maxmemory 256MB |
| Docker daemon | ~50MB | |
| Tổng | ~850MB | Còn ~15GB cho k6, OS |
