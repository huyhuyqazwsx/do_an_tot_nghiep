# Hệ thống Đăng ký Tín chỉ — Backend (Đồ án tốt nghiệp)

Backend cho hệ thống đăng ký tín chỉ sinh viên, giải quyết bài toán **đăng ký học phần với độ tranh chấp cao** (hàng nghìn sinh viên cùng giành số lượng chỗ giới hạn của mỗi lớp học phần tại thời điểm mở đăng ký). Hệ thống thiết kế theo mô hình **queue-based load leveling**: API tiếp nhận yêu cầu và trả về ngay, việc trừ chỗ được xử lý bất đồng bộ qua RabbitMQ với câu lệnh SQL nguyên tử trên PostgreSQL, Redis đóng vai trò cache đọc nhanh (fast-fail).

> Frontend là repository riêng: `do_an_fe` (React + Vite). Đặc tả API cho frontend xem tại [docs/fe-api-spec.md](docs/fe-api-spec.md).

## 1. Công nghệ và thư viện sử dụng

| Thành phần | Công nghệ | Phiên bản |
|---|---|---|
| Runtime | Node.js | >= 20 (khuyến nghị 22.x) |
| Framework | NestJS (monorepo) | 11.x |
| Ngôn ngữ | TypeScript | 5.7 |
| CSDL | PostgreSQL | >= 14 |
| ORM | Prisma | 5.22 |
| Cache | Redis (ioredis) | Redis 7 / ioredis 5.10 |
| Message queue | RabbitMQ (amqplib + amqp-connection-manager) | RabbitMQ 3.x |
| Xác thực | JWT (@nestjs/jwt, passport-jwt) | 11.x / 4.x |
| Gửi mail | nodemailer (Gmail SMTP) | 8.x |
| Tài liệu API | Swagger (@nestjs/swagger) | 11.x |
| Cron job | @nestjs/schedule | 6.x |
| Quản lý tiến trình | PM2 | (cài global) |
| Kiểm thử tải | k6 | (scripts/k6) |
| Unit test | Jest | 30.x |

Danh sách đầy đủ và phiên bản chính xác xem trong [package.json](package.json).

## 2. Cấu trúc dự án

NestJS monorepo gồm **3 ứng dụng + 1 thư viện dùng chung**:

| Project | Đường dẫn | Vai trò |
|---|---|---|
| `do-an` | `apps/do-an` | REST API (ứng dụng duy nhất mở cổng HTTP — mặc định 3000). Swagger tại `/api/docs` |
| `worker` | `apps/worker` | Consumer RabbitMQ — xử lý bất đồng bộ các batch đăng ký/hủy đăng ký, trừ/hoàn chỗ nguyên tử trong PostgreSQL |
| `scheduler` | `apps/scheduler` | Cron job: prewarm cache Redis, đối soát (reconcile) số chỗ giữa Redis và PostgreSQL, gửi email thông báo |
| `shared` | `libs/shared` | Hạ tầng dùng chung (Prisma, Redis, RabbitMQ, JWT guard/decorator) — import qua alias `@app/shared` |

Các module API chính (`apps/do-an/src/modules`): `auth`, `users`, `courses`, `class-sections`, `registrations`, `registration-slots`, `grades`, `settings`, `dashboard`.

Tài liệu thiết kế chi tiết (tiếng Việt):
- [docs/doc/thiet-ke-he-thong.md](docs/doc/thiet-ke-he-thong.md) — thiết kế hệ thống, luồng xử lý, khả năng chịu lỗi
- [docs/doc/database-design.md](docs/doc/database-design.md) — thiết kế CSDL (8 bảng)
- [docs/doc/sequence-diagrams.md](docs/doc/sequence-diagrams.md) — sequence diagram toàn bộ nghiệp vụ
- [docs/fe-api-spec.md](docs/fe-api-spec.md) — đặc tả API cho frontend

## 3. Yêu cầu môi trường

- Node.js >= 20 và npm
- Docker + Docker Compose (để chạy Redis và RabbitMQ)
- PostgreSQL >= 14 (chạy ngoài docker-compose, cấu hình qua `DATABASE_URL`)
- (Tùy chọn) PM2 cài global nếu chạy chế độ production: `npm install -g pm2`
- (Tùy chọn) k6 nếu chạy kiểm thử tải

## 4. Cài đặt và chạy hệ thống

### Bước 1 — Cài dependency

```bash
npm install
```

### Bước 2 — Khởi động hạ tầng (Redis + RabbitMQ)

```bash
docker compose up -d
```

Lệnh trên khởi động:
- **Redis 7** tại `localhost:6379` (bật AOF persistence)
- **RabbitMQ 3** tại `localhost:5672` (giao diện quản trị: `http://localhost:15672`, tài khoản `guest`/`guest`)

PostgreSQL cần được cài/chạy riêng. Tạo một database trống (ví dụ `do_an`).

### Bước 3 — Cấu hình biến môi trường

Sao chép file mẫu và điền giá trị thực:

```bash
cp .env.example .env
```

Các biến quan trọng:

| Biến | Ý nghĩa | Ví dụ |
|---|---|---|
| `DATABASE_URL` | Chuỗi kết nối PostgreSQL cho Prisma (bắt buộc) | `postgresql://postgres:postgres@localhost:5432/do_an?schema=public` |
| `REDIS_HOST` / `REDIS_PORT` | Kết nối Redis | `localhost` / `6379` |
| `RABBITMQ_URL` | URL kết nối RabbitMQ (mặc định `amqp://guest:guest@localhost:5672`) | |
| `JWT_SECRET` / `JWT_EXPIRES_IN` | Khóa ký và thời hạn JWT | chuỗi ngẫu nhiên dài / `1d` |
| `MAIL_USER` / `MAIL_APP_PASSWORD` | Gmail + App Password để gửi OTP và email thông báo (không bắt buộc để chạy các luồng khác) | |
| `PORT` | Cổng HTTP của API (mặc định `3000`) | |
| `ENABLE_DLQ_CONSUMER` | Bật consumer Dead-Letter Queue (chỉ đặt `true` cho 1 tiến trình worker riêng) | `false` |

### Bước 4 — Khởi tạo cơ sở dữ liệu

Cách nhanh (đồng bộ schema trực tiếp, phù hợp môi trường chấm/demo):

```bash
npm run prisma:push        # prisma db push && prisma generate
```

Hoặc áp dụng đầy đủ lịch sử migration (khuyến nghị cho production):

```bash
npx prisma migrate deploy
npx prisma generate
```

### Bước 5 — Chạy hệ thống (chế độ development)

Chạy từng ứng dụng ở các terminal riêng:

```bash
npm run start:dev            # API           → http://localhost:3000
npm run start:dev:worker     # Worker (consumer RabbitMQ)
npm run start:dev:scheduler  # Scheduler (cron prewarm/reconcile)
```

Tối thiểu cần chạy **API + Worker** để luồng đăng ký hoạt động; **Scheduler** cần chạy để cache Redis được prewarm/đối soát.

Sau khi API khởi động:
- Swagger UI: `http://localhost:3000/api/docs`
- Tài khoản admin mặc định được **tự động tạo** nếu chưa tồn tại (xem mục 6).

### Chạy chế độ production (PM2)

```bash
npm run build                # build cả 3 app vào dist/
npm run pm2:start            # theo ecosystem.config.js: 3 API (cluster) + 11 worker + 1 worker DLQ + 1 scheduler
# hoặc gộp cả hai bước:
npm run deploy
# theo dõi:
npm run pm2:logs
npm run pm2:monit
```

## 5. Nạp dữ liệu thử nghiệm

Đăng nhập bằng tài khoản **admin** rồi import dữ liệu qua API (hoặc qua giao diện admin của frontend):

1. **Sinh viên**: `POST /api/users/import` với file [users_import.csv](users_import.csv) ở gốc repo (~2000 sinh viên test, mật khẩu đều là `1`).
2. **Môn học**: `POST /api/courses/import` với file [docs/data-source/courses.csv](docs/data-source/courses.csv).
3. **Lớp học phần**: `POST /api/class-sections/import` với file thời khóa biểu trong [docs/data-source/](docs/data-source/) (file `TKB2025...csv`).
4. Vào `PATCH /api/settings` (hoặc trang Settings của admin) đặt **học kỳ hiện tại** và **khung thời gian mở đăng ký**; tạo đợt đăng ký theo dải MSSV tại `POST /api/registration-slots`.

## 6. Tài khoản thử nghiệm

| Vai trò | Mã đăng nhập | Mật khẩu | Ghi chú |
|---|---|---|---|
| Admin | `999999999` | `admin` | Tự động tạo khi API khởi động lần đầu (nếu chưa có) |
| Sinh viên | `20225330` (hoặc bất kỳ MSSV nào trong `users_import.csv`) | `1` | Có sau khi import file `users_import.csv` |

Đăng nhập: `POST /api/auth/login` với body `{ "studentCode": "...", "password": "..." }`.

## 7. Kiểm thử

```bash
npm run test        # unit test (Jest)
npm run test:e2e    # end-to-end test
npm run test:cov    # coverage
npm run lint        # eslint --fix
```

Kiểm thử tải (cần cài [k6](https://k6.io)):

```bash
# Mô phỏng nhiều sinh viên đồng thời gửi batch đăng ký
k6 run scripts/k6/registration-batch.js
# Kịch bản tranh chấp: N sinh viên giành 1 lớp ít chỗ
k6 run -e PASSWORD=1 scripts/k6/tc03-concurrency.js
```

Chi tiết tham số từng kịch bản xem chú thích đầu mỗi file trong [scripts/k6/](scripts/k6/).

## 8. Tóm tắt kiến trúc luồng đăng ký

1. Sinh viên gửi `POST /api/registrations/batches` → API kiểm tra hợp lệ (khung giờ đăng ký, trần tín chỉ, trùng lịch, môn tiên quyết), ghi batch trạng thái `PENDING` vào PostgreSQL, đẩy message vào RabbitMQ và **trả về ngay** kèm `batchId`.
2. **Worker** tiêu thụ message, trừ chỗ nguyên tử bằng một câu SQL duy nhất: `UPDATE class_sections SET sl_dk = sl_dk + 1 WHERE id = ? AND sl_dk < sl_max` — PostgreSQL bảo đảm không bao giờ vượt sĩ số dù hàng nghìn yêu cầu đồng thời.
3. Xử lý lỗi: retry tối đa 6 lần, sau đó chuyển vào **Dead-Letter Queue** cho worker DLQ riêng xử lý.
4. Frontend poll `GET /api/registrations/batches/:batchId` để hiển thị kết quả từng lớp.
5. **Scheduler** prewarm số chỗ vào Redis mỗi phút và đối soát Redis ↔ PostgreSQL mỗi 10 phút; Redis chỉ là cache — PostgreSQL luôn là nguồn dữ liệu chuẩn.
