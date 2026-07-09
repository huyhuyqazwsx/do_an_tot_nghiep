/**
 * TC-03 — Không ghi vượt chỗ khi tương tranh (race condition).
 *
 * Mục tiêu: N sinh viên KHÁC NHAU cùng gửi đăng ký ĐÚNG 1 lớp có sl_max nhỏ
 * (lý tưởng = 1) gần như đồng thời. Hệ thống phải chỉ cho đúng sl_max item
 * SUCCESS, phần còn lại FAILED "hết chỗ", và sl_dk KHÔNG vượt sl_max.
 *
 * KHÁC với registration-batch.js: ở đây KHÔNG sleep, KHÔNG poll giữa chừng,
 * mọi VU bắn vào CÙNG MỘT mã lớp để tối đa hóa độ tương tranh.
 *
 * ─── Chuẩn bị trước khi chạy (Admin) ──────────────────────────────────────────
 *   1. Mở cổng đăng ký + tạo registration-slot phủ dải MSSV test + giờ hiện tại.
 *   2. Tạo (hoặc chọn) 1 lớp test, đặt sl_max = SEAT_LIMIT (vd 1), sl_dk = 0.
 *      Lấy mã lớp (ma_lop) của nó truyền vào SECTION_CODE, và id để kiểm chứng.
 *   3. Đảm bảo worker đang chạy để tiêu hàng đợi.
 *
 * ─── Chạy ─────────────────────────────────────────────────────────────────────
 *   k6 run \
 *     -e SECTION_CODE=156968 \
 *     -e VUS=50 \
 *     -e SEMESTER=20242 \
 *     -e STUDENT_START=20225331 \
 *     -e PASSWORD=1 \
 *     scripts/k6/tc03-concurrency.js
 *
 * ─── Kiểm chứng SAU khi chạy (đợi worker tiêu hết queue ~ vài giây) ────────────
 *   -- Postgres:
 *   SELECT ma_lop, sl_dk, sl_max FROM class_sections WHERE ma_lop = '156968';
 *     → ĐẠT khi sl_dk = sl_max (vd 1), KHÔNG vượt.
 *
 *   SELECT i.status, count(*)
 *   FROM registration_batch_items i
 *   JOIN class_sections cs ON cs.id = i.class_section_id
 *   WHERE cs.ma_lop = '156968'
 *   GROUP BY i.status;
 *     → ĐẠT khi đúng SEAT_LIMIT item SUCCESS, còn lại FAILED ("hết chỗ").
 *
 *   -- Redis (sau chu kỳ reconcile, hoặc đọc trực tiếp):
 *   redis-cli GET reg:section:slots:{classSectionId}
 */
import http from "k6/http";
import { check } from "k6";
import { Counter } from "k6/metrics";
import { SharedArray } from "k6/data";
import exec from "k6/execution";

const BASE_URL = __ENV.BASE_URL || "http://localhost:3000";
const SEMESTER = __ENV.SEMESTER || "20242";
const PASSWORD = __ENV.PASSWORD || "1";
const SECTION_CODE = __ENV.SECTION_CODE || "157517"; // BẮT BUỘC: mã lớp test (sl_max nhỏ)
const VUS = Number(__ENV.VUS || "50"); // số SV đua vào cùng lớp
const STUDENT_START = Number(__ENV.STUDENT_START || "20225331");

// Mỗi VU đăng nhập 1 MSSV khác nhau, gửi ĐÚNG 1 request đăng ký rồi dừng.
// shared-iterations + iterations = VUS → tổng cộng đúng VUS lượt đăng ký,
// các VU khởi động gần như đồng thời để tạo tương tranh.
export const options = {
  scenarios: {
    tc03_race: {
      executor: "shared-iterations",
      vus: VUS,
      iterations: VUS,
      maxDuration: "60s",
    },
  },
};

const accepted201 = new Counter("create_accepted"); // API nhận (đẩy vào queue)
const rejectedApi = new Counter("create_rejected_api"); // API từ chối ngay (vd 409, hết chỗ fail-fast)
const loginFailed = new Counter("login_failed");

export function setup() {
  if (!SECTION_CODE) {
    throw new Error(
      "Thiếu SECTION_CODE. Truyền mã lớp test: -e SECTION_CODE=<ma_lop>",
    );
  }
  console.log(
    `TC-03: ${VUS} SV đua vào lớp ${SECTION_CODE} (semester ${SEMESTER}). ` +
    `MSSV ${STUDENT_START}..${STUDENT_START + VUS - 1}.`,
  );
}

export default function () {
  // Mỗi VU/iteration một MSSV riêng → không trùng tài khoản.
  const studentCode = String(STUDENT_START + exec.scenario.iterationInTest);

  const token = login(studentCode, PASSWORD);
  if (!token) {
    loginFailed.add(1);
    return;
  }

  // Gửi thẳng — KHÔNG sleep, KHÔNG search trước, để các request dồn vào cùng lúc.
  const res = http.post(
    `${BASE_URL}/api/registrations/batches`,
    JSON.stringify({ semester: SEMESTER, sectionCodes: [SECTION_CODE] }),
    authParams(token),
  );

  const ok = res.status === 200 || res.status === 201;
  if (ok) {
    accepted201.add(1);
  } else {
    rejectedApi.add(1);
    console.log(
      `[${studentCode}] API từ chối (status ${res.status}): ${res.body}`,
    );
  }

  check(res, {
    "đăng ký được tiếp nhận hoặc từ chối hợp lệ": (r) =>
      r.status === 200 || r.status === 201 || r.status === 409 || r.status === 400,
  });
}

function login(studentCode, password) {
  const res = http.post(
    `${BASE_URL}/api/auth/login`,
    JSON.stringify({ studentCode, password }),
    { headers: { "Content-Type": "application/json" } },
  );
  if (res.status !== 200 && res.status !== 201) return null;
  return res.json("accessToken");
}

function authParams(token) {
  return {
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
  };
}
