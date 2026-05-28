import http from "k6/http";
import { check, fail, sleep } from "k6";
import { Counter, Rate, Trend } from "k6/metrics";
import { SharedArray } from "k6/data";
import exec from "k6/execution";

const BASE_URL = __ENV.BASE_URL || "http://localhost:3000";
const SEMESTER = __ENV.SEMESTER || "20252";
const PASSWORD = __ENV.PASSWORD || "1";
const SECTION_CODES_FILE = __ENV.SECTION_CODES_FILE || "scripts/k6/section-codes.json";
const STUDENT_START = Number(__ENV.STUDENT_START || "20225331");
const STUDENT_END = Number(__ENV.STUDENT_END || "20226331");
const SECTIONS_PER_BATCH = Number(__ENV.SECTIONS_PER_BATCH || "1");
const SECTION_LIMIT = Number(__ENV.SECTION_LIMIT || "500");
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

const createBatchOk = new Rate("create_batch_ok");
const cancelBatchOk = new Rate("cancel_batch_ok");
const batchCompleted = new Rate("batch_completed");
const loginOk = new Rate("login_ok");
const apiRejected = new Counter("api_rejected");
const batchPollDuration = new Trend("batch_poll_duration");

const users = new SharedArray("students", () => {
  const result = [];
  for (let code = STUDENT_START; code <= STUDENT_END; code += 1) {
    result.push(String(code));
  }
  return result;
});

const configuredSectionCodes = new SharedArray("section-codes", () => {
  try {
    const parsed = JSON.parse(open(SECTION_CODES_FILE));
    if (!Array.isArray(parsed)) return [];
    return parsed.map((code) => String(code).trim()).filter(Boolean);
  } catch {
    return [];
  }
});

export function setup() {
  if (configuredSectionCodes.length > 0) {
    return { sectionCodes: configuredSectionCodes };
  }

  const adminToken = login("999999999", "admin");
  if (!adminToken) {
    fail("Cannot login admin to prepare class section list");
  }

  const res = http.get(
    `${BASE_URL}/api/class-sections?semester=${encodeURIComponent(SEMESTER)}&limit=${SECTION_LIMIT}&sortBy=sectionCode&sortOrder=asc`,
    authParams(adminToken),
  );

  check(res, {
    "setup class sections loaded": (r) => r.status === 200,
  });

  if (res.status !== 200) {
    fail(`Cannot load class sections: status=${res.status} body=${res.body}`);
  }

  const body = res.json();
  const codes = [];
  const seen = new Set();

  for (const item of body.items || []) {
    if (!item.sectionCode || seen.has(item.sectionCode)) continue;
    if (item.sectionStatus === "CANCELLED" || item.sectionStatus === "REGISTRATION_CLOSED") continue;
    if (Number(item.registeredCount || 0) >= Number(item.maxCapacity || 0)) continue;
    seen.add(item.sectionCode);
    codes.push(item.sectionCode);
  }

  if (codes.length < SECTIONS_PER_BATCH) {
    fail(`Not enough open class sections for test. Found=${codes.length}`);
  }

  return { sectionCodes: codes };
}

export default function (data) {
  const iterationIndex = exec.scenario.iterationInTest;
  const studentCode = users[iterationIndex % users.length];
  const token = login(studentCode, PASSWORD);
  loginOk.add(!!token);
  if (!token) return;

  const sectionCodes = pickSections(data.sectionCodes, iterationIndex);
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
    apiRejected.add(1);
    return;
  }

  const batchId = createRes.json("batchId");
  let createBatch = null;
  if (POLL_BATCH && batchId) {
    createBatch = pollBatch(token, batchId);
  }

  if (CANCEL_AFTER_CREATE && createBatch) {
    const successfulCodes = successSectionCodes(createBatch);
    if (successfulCodes.length > 0) {
      cancelRegisteredSections(token, successfulCodes);
    }
  }

  sleep(1);
}

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
    const code = item.status === "SUCCESS" ? item.classSection?.sectionCode : null;
    if (!code || seen.has(code)) continue;
    seen.add(code);
    codes.push(code);
  }

  return codes;
}

function pickSections(sectionCodes, iterationIndex) {
  const start = (iterationIndex * SECTIONS_PER_BATCH) % sectionCodes.length;
  const result = [];
  for (let i = 0; i < SECTIONS_PER_BATCH; i += 1) {
    result.push(sectionCodes[(start + i) % sectionCodes.length]);
  }
  return result;
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
