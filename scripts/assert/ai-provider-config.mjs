#!/usr/bin/env node
// F171 contract: AI 叙事供应商配置 + 无依赖 .env 加载。
//   (a) 子进程清空 OPENCODE_GO_API_KEY，在临时目录写 .env
//       （OPENCODE_GO_API_KEY=from-dotenv），loadEnv(tmp) 后
//       gateway.isConfigured() 必须为 true；
//   (b) 只给 AI_ALIYUN_* 时 fetch 桩必须命中
//       ${AI_ALIYUN_BASE_URL}/chat/completions、body.model ===
//       AI_ALIYUN_MODEL、请求头不得含 x-opencode-session、
//       generate() 返回 ok:true 且 text 来自桩响应；
//   (c) 给 OPENCODE_GO_API_KEY 时 URL 命中 opencode.ai/zen/go 且
//       请求头含 x-opencode-session；
//   (d) 两者都缺时 generate() 返回 code:"no-key" 且 fetch 桩 0 次调用。
//
// 全程 fetch 桩，零真实网络；每个场景在 env -i 式干净子进程里跑，
// 父进程环境里的真实密钥绝不泄漏进断言。
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { fileURLToPath } from "node:url";

const execFileP = promisify(execFile);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const GATEWAY = path.join(ROOT, "server", "ai", "gateway.js");
const LOAD_ENV = path.join(ROOT, "server", "load-env.js");

let failures = 0;
function check(name, cond, detail = "") {
  if (cond) console.log(`[PASS] ${name}`);
  else {
    failures += 1;
    console.log(`[FAIL] ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

// 子进程脚本：按 SCENARIO 走两条路径之一，结果以一行 __RESULT__<json> 回传。
// dotenv：临时目录写 .env → loadEnv(tmp) → 回传 isConfigured()。
// gen：fetch 桩记录全部调用 → 回传 isConfigured() + 调用捕获 + generate 结果。
const CHILD = `
const fs = require("fs");
const os = require("os");
const path = require("path");
const out = (obj) => console.log("__RESULT__" + JSON.stringify(obj));
(async () => {
  if (process.env.SCENARIO === "dotenv") {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "f171-env-"));
    fs.writeFileSync(path.join(tmp, ".env"), "OPENCODE_GO_API_KEY=from-dotenv\\n");
    require(${JSON.stringify(LOAD_ENV)}).loadEnv(tmp);
    const gw = require(${JSON.stringify(GATEWAY)});
    out({ configured: gw.isConfigured(), dotenvKey: process.env.OPENCODE_GO_API_KEY });
    return;
  }
  const gw = require(${JSON.stringify(GATEWAY)});
  const calls = [];
  const fetchImpl = async (url, opts) => {
    calls.push({ url, headers: opts.headers, body: JSON.parse(opts.body) });
    return {
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({ choices: [{ message: { content: "stubbed narration" } }] }),
    };
  };
  const r = await gw.generate({
    messages: [{ role: "user", content: "hi" }],
    sessionId: "sess-assert",
    fetchImpl,
  });
  out({
    configured: gw.isConfigured(),
    calls,
    result: { ok: r.ok, code: r.code, text: r.text, model: r.model },
  });
})().catch((e) => {
  console.error(e && e.stack ? e.stack : String(e));
  process.exit(2);
});
`;

// env -i 思路：白名单 env 对象，不带入父进程的任何密钥/IPC 变量。
async function runChild(extraEnv) {
  const { stdout } = await execFileP(process.execPath, ["-e", CHILD], {
    env: { PATH: process.env.PATH || "", ...extraEnv },
    cwd: ROOT,
    timeout: 20000,
    maxBuffer: 4 * 1024 * 1024,
  });
  const line = stdout.split("\n").find((l) => l.startsWith("__RESULT__"));
  if (!line) throw new Error(`child produced no result line: ${stdout.slice(0, 400)}`);
  return JSON.parse(line.slice("__RESULT__".length));
}

// (a) .env 注入：干净环境（无 OPENCODE_GO_API_KEY）→ loadEnv(tmp) → isConfigured()
const a = await runChild({ SCENARIO: "dotenv" });
check("(a) loadEnv(tmp) 注入 .env 后 isConfigured() === true", a.configured === true);
check("(a) .env 的键值真的落进 process.env", a.dotenvKey === "from-dotenv");

// (b) 仅 AI_ALIYUN_*：DashScope 兼容端点 + 自定义模型 + 无 session 头
const b = await runChild({
  SCENARIO: "gen",
  AI_ALIYUN_API_KEY: "ak",
  AI_ALIYUN_BASE_URL: "https://example.test/compatible-mode/v1",
  AI_ALIYUN_MODEL: "qwen-x",
});
const bCall = b.calls && b.calls[0];
check("(b) isConfigured() === true", b.configured === true);
check("(b) fetch 桩恰好被调 1 次", b.calls && b.calls.length === 1);
check(
  "(b) URL 命中 AI_ALIYUN_BASE_URL/chat/completions",
  bCall && bCall.url === "https://example.test/compatible-mode/v1/chat/completions",
  bCall && bCall.url
);
check("(b) body.model === AI_ALIYUN_MODEL", bCall && bCall.body.model === "qwen-x");
check(
  "(b) 请求头不含 x-opencode-session",
  bCall && !("x-opencode-session" in bCall.headers)
);
check(
  "(b) Authorization 头是 Bearer <key>",
  bCall && bCall.headers.Authorization === "Bearer ak"
);
check("(b) generate() ok:true 且 text 来自桩", b.result.ok === true && b.result.text === "stubbed narration");

// (c) OPENCODE_GO_API_KEY：原供应商路径不变（URL + session 头）
const c = await runChild({ SCENARIO: "gen", OPENCODE_GO_API_KEY: "k2" });
const cCall = c.calls && c.calls[0];
check(
  "(c) URL 命中 opencode.ai/zen/go",
  cCall && cCall.url === "https://opencode.ai/zen/go/v1/chat/completions",
  cCall && cCall.url
);
check(
  "(c) 请求头含 x-opencode-session",
  cCall && cCall.headers["x-opencode-session"] === "sess-assert"
);
check("(c) body.model === deepseek-v4.1-flash", cCall && cCall.body.model === "deepseek-v4.1-flash");
check("(c) generate() ok:true", c.result.ok === true);

// (d) 双键皆缺：no-key 且不发请求
const d = await runChild({ SCENARIO: "gen" });
check("(d) isConfigured() === false", d.configured === false);
check("(d) generate() code === no-key", d.result.ok === false && d.result.code === "no-key");
check("(d) fetch 桩调用次数 === 0", d.calls && d.calls.length === 0);

if (failures > 0) {
  console.error(`[ASSERT] ${failures} check(s) failed`);
  process.exit(1);
}
console.log("ai-provider-config OK");
