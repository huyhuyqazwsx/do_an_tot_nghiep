import http from "k6/http";
import { check, fail, sleep } from "k6";
import { Counter, Rate, Trend } from "k6/metrics";
import { SharedArray } from "k6/data";
import exec from "k6/execution";

const BASE_URL = __ENV.BASE_URL || "http://localhost:3000";
const SEMESTER = __ENV.SEMESTER || "20242";
const PASSWORD = __ENV.PASSWORD || "1";
const SECTION_CODES_FILE =
  __ENV.SECTION_CODES_FILE || "./section-codes.json";
const STUDENT_START = Number(__ENV.STUDENT_START || "20225331");
const STUDENT_END = Number(__ENV.STUDENT_END || "20226331");
const GROUP_SIZE = Number(__ENV.GROUP_SIZE || "100");
const POLL_BATCH = (__ENV.POLL_BATCH || "true") !== "false";
const CANCEL_AFTER_CREATE = (__ENV.CANCEL_AFTER_CREATE || "true") !== "false";
const POLL_ATTEMPTS = Number(__ENV.POLL_ATTEMPTS || "20");
const POLL_INTERVAL_SECONDS = Number(__ENV.POLL_INTERVAL_SECONDS || "0.5");

export const options = {
  scenarios: {
    registration_batch: {
      executor: "ramping-vus",
      stages: [
        { duration: "30s", target: 800 },
        { duration: "1m", target: 800 },
        { duration: "30s", target: 0 },
      ],
      gracefulRampDown: "10s",
    },
  },
  thresholds: {
    http_req_failed: ["rate<0.05"],
    http_req_duration: ["p(95)<1000"],
    create_batch_ok: ["rate>0.90"],
    cancel_batch_ok: ["rate>0.85"],
    batch_completed: ["rate>0.85"],
  },
};

// ─── Custom metrics ──────────────────────────────────────────────────────────

const createBatchOk = new Rate("create_batch_ok");
const cancelBatchOk = new Rate("cancel_batch_ok");
const batchCompleted = new Rate("batch_completed");
const loginOk = new Rate("login_ok");
const searchOk = new Rate("search_ok");
const apiRejected = new Counter("api_rejected");
const batchPollDuration = new Trend("batch_poll_duration");
const searchDuration = new Trend("search_duration");

// ─── Shared data ─────────────────────────────────────────────────────────────

const users = new SharedArray("students", () => {
  const result = [];
  for (let code = STUDENT_START; code <= STUDENT_END; code += 1) {
    result.push(String(code));
  }
  return result;
});

/**
 * section-codes.json format: mảng của mảng
 * [
 *   ["166235", "166300"],   ← nhóm 0 (SV 0–99) đăng ký 2 lớp này
 *   ["166355"],             ← nhóm 1 (SV 100–199) đăng ký lớp này
 *   ["166380", "166400"]    ← nhóm 2 (SV 200–299) đăng ký 2 lớp này
 * ]
 */
const sectionCodeBatches = new SharedArray("section-code-batches", () => {
  try {
    const parsed = JSON.parse(open(SECTION_CODES_FILE));
    if (!Array.isArray(parsed)) return [];
    // Hỗ trợ cả format cũ (mảng phẳng) lẫn format mới (mảng của mảng)
    if (parsed.length > 0 && !Array.isArray(parsed[0])) {
      // Format cũ: ["code1", "code2"] → chuyển thành [["code1"], ["code2"]]
      return parsed.map((code) => [String(code).trim()]);
    }
    return parsed.map((batch) =>
      batch.map((code) => String(code).trim()).filter(Boolean),
    );
  } catch {
    return [];
  }
});

// ─── Setup ───────────────────────────────────────────────────────────────────

export function setup() {
  if (sectionCodeBatches.length > 0) {
    console.log(
      `Loaded ${sectionCodeBatches.length} section code batches from ${SECTION_CODES_FILE}`,
    );
    for (let i = 0; i < sectionCodeBatches.length; i++) {
      console.log(
        `  Batch[${i}] (SV ${i * GROUP_SIZE}–${(i + 1) * GROUP_SIZE - 1}): [${sectionCodeBatches[i].join(", ")}]`,
      );
    }
    return { batches: sectionCodeBatches };
  }

  fail(
    `No section codes found in ${SECTION_CODES_FILE}. Please create the file with format: [["code1","code2"], ["code3"]]`,
  );
}

// ─── Main scenario ───────────────────────────────────────────────────────────

export default function (data) {
  const iterationIndex = exec.scenario.iterationInTest;
  const studentCode = users[iterationIndex % users.length];
  const token = login(studentCode, PASSWORD);
  loginOk.add(!!token);
  if (!token) return;

  // 1. Chọn bộ section codes theo nhóm
  const groupIndex = Math.floor(iterationIndex / GROUP_SIZE);
  const batchIndex = groupIndex % sectionCodeBatches.length;
  const sectionCodes = sectionCodeBatches[batchIndex];

  // 2. Tìm kiếm lớp (giống luồng thật: SV search mã lớp → xem kết quả → chọn)
  for (const code of sectionCodes) {
    searchClassSection(token, code);
  }

  // 3. Gửi đăng ký batch
  const createRes = http.post(
    `${BASE_URL}/api/registrations/batches`,
    JSON.stringify({ semester: SEMESTER, sectionCodes }),
    authParams(token),
  );

  const accepted = createRes.status === 201 || createRes.status === 200;
  createBatchOk.add(accepted);

  check(createRes, {
    "create batch accepted": (r) => r.status === 201 || r.status === 200,
    "create batch has batchId": (r) => !!safeJson(r)?.batchId,
  });

  if (!accepted) {
    console.log(`Failed to create batch (status ${createRes.status}):`, createRes.body);
    apiRejected.add(1);
    return;
  }

  // 4. Poll kết quả batch
  const batchId = createRes.json("batchId");
  let createBatch = null;
  if (POLL_BATCH && batchId) {
    createBatch = pollBatch(token, batchId);
  }

  // 5. Hủy lớp vừa đăng ký (giả lập SV thay đổi lịch)
  if (CANCEL_AFTER_CREATE && createBatch) {
    const successfulCodes = successSectionCodes(createBatch);
    if (successfulCodes.length > 0) {
      cancelRegisteredSections(token, successfulCodes);
    }
  }

  sleep(1);
}

// ─── Search class section (giả lập FE search trước khi chọn lớp) ────────────

function searchClassSection(token, sectionCode) {
  const startedAt = Date.now();
  const res = http.get(
    `${BASE_URL}/api/class-sections?semester=${encodeURIComponent(SEMESTER)}&sectionCode=${encodeURIComponent(sectionCode)}&limit=20`,
    authParams(token),
  );

  const elapsed = Date.now() - startedAt;
  searchDuration.add(elapsed);

  const ok = res.status === 200;
  searchOk.add(ok);

  check(res, {
    "search class section ok": (r) => r.status === 200,
  });

  return ok;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function login(studentCode, password) {
  const res = http.post(
    `${BASE_URL}/api/auth/login`,
    JSON.stringify({ studentCode, password }),
    { headers: { "Content-Type": "application/json" } },
  );

  check(res, {
    "login status ok": (r) => r.status === 201 || r.status === 200,
  });

  if (res.status !== 201 && res.status !== 200) return null;
  return res.json("accessToken");
}

function pollBatch(token, batchId) {
  const startedAt = Date.now();

  for (let attempt = 0; attempt < POLL_ATTEMPTS; attempt += 1) {
    const res = http.get(
      `${BASE_URL}/api/registrations/batches/${batchId}`,
      authParams(token),
    );

    if (res.status === 200 && res.json("status") === "COMPLETED") {
      batchCompleted.add(true);
      batchPollDuration.add(Date.now() - startedAt);
      return res.json();
    }

    sleep(POLL_INTERVAL_SECONDS);
  }

  batchCompleted.add(false);
  batchPollDuration.add(Date.now() - startedAt);
  return null;
}

function cancelRegisteredSections(token, sectionCodes) {
  const cancelRes = http.del(
    `${BASE_URL}/api/registrations/batches`,
    JSON.stringify({ semester: SEMESTER, sectionCodes }),
    authParams(token),
  );

  const accepted = cancelRes.status === 201 || cancelRes.status === 200;
  cancelBatchOk.add(accepted);

  check(cancelRes, {
    "cancel batch accepted": (r) => r.status === 201 || r.status === 200,
    "cancel batch has batchId": (r) => !!safeJson(r)?.batchId,
  });

  if (!accepted) {
    apiRejected.add(1);
    return;
  }

  const batchId = cancelRes.json("batchId");
  if (POLL_BATCH && batchId) {
    pollBatch(token, batchId);
  }
}

function successSectionCodes(batch) {
  const codes = [];
  const seen = new Set();

  for (const item of batch.items || []) {
    const code =
      item.status === "SUCCESS" ? item.classSection?.sectionCode : null;
    if (!code || seen.has(code)) continue;
    seen.add(code);
    codes.push(code);
  }

  return codes;
}

function authParams(token) {
  return {
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
  };
}

function safeJson(res) {
  try {
    return res.json();
  } catch {
    return null;
  }
}
