import { NextResponse } from 'next/server';
import { appendFileSync } from 'node:fs';
import path from 'node:path';
import type {
  ConfirmationDish,
  Workflow1RouteResponse,
} from '@/app/confirm/confirm-data';

/**
 * 诊断日志：同时打印到服务端控制台 + 追加写入项目根目录的 workflow1-debug.log。
 * 只写阶段/耗时/数量/错误码等元信息，绝不含 Token、图片数据或菜品内容。
 * 日志写入失败绝不影响主流程。
 */
const DEBUG_LOG_PATH = path.join(process.cwd(), 'workflow1-debug.log');
function debugLog(message: string) {
  const line = `[${new Date().toISOString()}] [workflow1] ${message}\n`;
  try {
    appendFileSync(DEBUG_LOG_PATH, line, 'utf8');
  } catch {
    // 忽略：日志文件不可写不影响业务
  }
  console.log(line.trimEnd());
}

/**
 * 开发者专用：每次调用追加一条结构化记录到 workflow1-runs.jsonl。
 * 只记录时间/耗时/执行 ID/调试链接等元信息，绝不含 Token、图片或菜品内容。
 * 该文件由隐藏的 /_dev/coze-runs 页面读取，不进入任何用户流程。
 */
const RUNS_LOG_PATH = path.join(process.cwd(), 'workflow1-runs.jsonl');
export interface Workflow1RunRecord {
  time: string;
  stage: 'success' | 'error';
  error?: string;
  upload_ms: number;
  workflow_ms: number;
  execute_id?: string;
  debug_url?: string;
}
function writeRunRecord(record: Workflow1RunRecord) {
  try {
    appendFileSync(RUNS_LOG_PATH, JSON.stringify(record) + '\n', 'utf8');
  } catch {
    // 忽略：调试日志不可写不影响业务
  }
}

/* ================================================================== */
/*  服务端 API Route｜调用 Coze 国内版工作流 1（图片识别）                */
/*                                                                    */
/*  两步链路：                                                          */
/*    1) POST https://api.coze.cn/v1/files/upload  (multipart/form-data)*
/*       → 取 data.id 作为 file_id                                     */
/*    2) POST https://api.coze.cn/v1/workflow/stream_run (SSE 流式)      */
/*       parameters.meal_image = JSON 序列化字符串 {"file_id":"..."}    */
/*       → 从 Message 事件的 data.content 中提取 confirmation_dishes    */
/*                                                                    */
/*  为何改用流式：非流式 workflow/run 90s 硬上限，图片识别工作流常超时。  */
/*  流式接口官方建议执行时间 5 分钟内，无 90s 断开限制。                  */
/*                                                                    */
/*  官方文档（核对日期 2026-11-23）：                                    */
/*    https://www.coze.cn/open/docs/developer_guides/upload_files       */
/*    https://www.coze.cn/open/docs/developer_guides/workflow_stream_run*/
/*                                                                    */
/*  安全约束：                                                          */
/*    - Token 仅本文件（服务端）读取，绝不下发前端、绝不打印、绝不写日志    */
/*    - 不手动设置 multipart/form-data 的 Content-Type（让 fetch 生成边界）*/
/*    - 只把 confirmation_dishes 返回前端，其它调试字段一律丢弃          */
/*    - 本文件独立实现，不修改、不依赖工作流 2 的 Route                   */
/* ================================================================== */

const COZE_FILE_UPLOAD_URL = 'https://api.coze.cn/v1/files/upload';
const COZE_WORKFLOW_STREAM_URL = 'https://api.coze.cn/v1/workflow/stream_run';
/** 文件上传通常几秒完成；流式工作流放宽到 3 分钟（官方建议 5 分钟内） */
const UPLOAD_TIMEOUT_MS = 60_000;
const WORKFLOW_TIMEOUT_MS = 180_000;

/** 请求体：复用上传页已有的压缩 dataURL，并携带目标热量（仅前端落库用） */
interface Workflow1RequestBody {
  meal_image: string;
  daily_target_kcal: number;
}

/** files/upload 响应中本 Route 需要的字段 */
interface CozeUploadResponse {
  code: number;
  msg?: string;
  data?: { id?: string; file_name?: string; bytes?: number };
}

/** dataURL 解析结果 */
interface ParsedDataUrl {
  mime: string;
  buffer: Buffer;
  extension: string;
}

/** SSE Message 事件 data 中本 Route 需要的字段 */
interface SseMessageData {
  content?: string;
  node_title?: string;
  node_is_finish?: boolean;
  node_seq_id?: string;
}

/** SSE 解析结果 */
interface SseParseResult {
  /** 提取到的 confirmation_dishes；未找到为 null */
  confirmationDishes: ConfirmationDish[] | null;
  /** Error 事件的错误信息；无错误为 null */
  errorMessage: string | null;
  /** 是否收到 Done 事件 */
  sawDone: boolean;
}

/** extractDishesFromSse 的返回结构（字段重命名自 SseParseResult） */
interface SseExtractResult {
  dishes: ConfirmationDish[] | null;
  errorMessage: string | null;
  sawDone: boolean;
}

/** SSE 流中携带的 Coze 调试信息（仅链接与执行 ID，不含任何敏感内容） */
interface SseDebugInfo {
  debugUrl: string | null;
  executeId: string | null;
}

/**
 * 从完整 SSE 文本中提取 debug_url / execute_id。
 * Coze 流式工作流在 Done 事件的 data 中返回形如
 *   {"debug_url":"https://www.coze.cn/work_flow?execute_id=...","execute_id":"...","usage":{...}}
 * 该链接可查看每个节点的输入输出，有效期 7 天。
 * 不同版本可能把整体再包一层字符串，故做两轮：
 *   1) 逐 data 行 JSON.parse 后取字段；
 *   2) 全文正则兜底，兼容被转义成 \"debug_url\" 的形式。
 */
function extractDebugInfo(fullText: string): SseDebugInfo {
  let debugUrl: string | null = null;
  let executeId: string | null = null;

  const blocks = fullText.replace(/\r\n/g, '\n').split('\n\n');
  for (const block of blocks) {
    let dataLine = '';
    for (const line of block.split('\n')) {
      if (line.startsWith('data:')) dataLine += line.slice(5).trim();
    }
    if (!dataLine) continue;
    try {
      const parsed = JSON.parse(dataLine) as Record<string, unknown>;
      if (!debugUrl && typeof parsed.debug_url === 'string' && parsed.debug_url) {
        debugUrl = parsed.debug_url;
      }
      if (!executeId) {
        const id = parsed.execute_id;
        // 只接受字符串；若上游给了数字，不经 JSON.parse（大整数会丢精度），
        // 交给下方全文正则从原始文本中提取完整的数字串。
        if (typeof id === 'string' && id) executeId = id;
      }
    } catch {
      // 非 JSON data（如 PING、纯文本分片），由下一轮正则兜底
    }
  }

  // 归一化被转义的斜杠，兼顾「整段 data 被字符串化」的情形
  const normalized = fullText.replace(/\\\//g, '/');
  if (!debugUrl) {
    const m = /\\?"debug_url\\?"\s*:\s*\\?"(https?:[^"\\]+)/.exec(normalized);
    if (m) debugUrl = m[1];
  }
  if (!debugUrl) {
    // 最后兜底：SSE 文本中任意位置出现的 Coze 试运行调试链接
    // （官方文档只说 Done 的 data 含 debug URL，未固定字段名）
    const m = /https?:\/\/(?:www\.)?coze\.(?:cn|com)\/work_flow\?[^"\s<>]+/.exec(
      normalized
    );
    if (m) debugUrl = m[0];
  }
  if (!executeId) {
    const m = /\\?"execute_id\\?"\s*:\s*\\?"?(\d{6,})/.exec(normalized);
    if (m) executeId = m[1];
  }
  if (!executeId && debugUrl) {
    // 从调试链接的 query 反解，避免上游只给链接不给独立字段
    const m = /[?&]execute_id=(\d+)/.exec(debugUrl);
    if (m) executeId = m[1];
  }
  return { debugUrl, executeId };
}

/** 统一错误响应（不携带任何敏感信息） */
function fail(
  error: string,
  status: number,
  stage: 'upload' | 'workflow' | 'parse' | 'config' | 'request',
  missing?: string[]
) {
  debugLog(`失败 stage=${stage} status=${status} error=${error}`);
  const body: Workflow1RouteResponse = {
    success: false,
    error,
    stage,
    ...(missing ? { missing } : {}),
  };
  return NextResponse.json(body, { status });
}

/**
 * 校验并解析图片 dataURL。
 * 支持 image/jpeg、image/jpg、image/png；Base64 内容解码为 Buffer。
 * 返回 null 表示格式非法。
 */
function parseDataUrl(dataUrl: string): ParsedDataUrl | null {
  const match = /^data:(image\/(?:jpeg|jpg|png));base64,([A-Za-z0-9+/=\s]+)$/.exec(
    dataUrl
  );
  if (!match) return null;
  const mime = match[1] === 'image/jpg' ? 'image/jpeg' : match[1];
  const base64 = match[2].replace(/\s/g, '');
  if (!base64) return null;
  try {
    const buffer = Buffer.from(base64, 'base64');
    if (buffer.length === 0) return null;
    return {
      mime,
      buffer,
      extension: mime === 'image/png' ? 'png' : 'jpg',
    };
  } catch {
    return null;
  }
}

/**
 * 尝试从一个 content 字符串中提取 confirmation_dishes。
 * content 通常是 JSON 序列化字符串，工作流输出可能：
 *   - 直接是 { confirmation_dishes: [...] }
 *   - 包一层 { output: "<JSON字符串>" } / { data: "<JSON字符串>" }
 * 这里递归解包，只取 confirmation_dishes，其余字段一律忽略。
 * 内部字段结构原样保留，不转换、不重命名。
 */
function dishesFromContent(content: string): ConfirmationDish[] | null {
  if (!content) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return null;
  }
  return dishesFromParsed(parsed, 0);
}

function dishesFromParsed(parsed: unknown, depth: number): ConfirmationDish[] | null {
  if (depth > 3 || typeof parsed !== 'object' || parsed === null) return null;
  const obj = parsed as Record<string, unknown>;
  const dishes = obj.confirmation_dishes;
  if (
    Array.isArray(dishes) &&
    dishes.length > 0 &&
    dishes.every((d) => typeof d === 'object' && d !== null)
  ) {
    return dishes as ConfirmationDish[];
  }
  // 递归解包常见包裹层
  for (const key of ['output', 'data']) {
    const nested = obj[key];
    if (typeof nested === 'string') {
      const found = dishesFromContent(nested);
      if (found) return found;
    } else if (typeof nested === 'object' && nested !== null) {
      const found = dishesFromParsed(nested, depth + 1);
      if (found) return found;
    }
  }
  return null;
}

/**
 * 解析累积的 SSE 文本（可能跨多次 read 分片）。
 * SSE 事件格式：以空行分隔，每行 `field: value`；字段有 id/event/data。
 * 只处理完整的事件块，尾部不完整部分由调用方保留到下次。
 *
 * 策略：
 *  - Error 事件 → 记录 error_message
 *  - Done 事件 → 标记结束
 *  - Message 事件 → data.content 可能是流式分片，按 node 分组累积后尝试解析；
 *    结束节点常有一条汇总消息（content 是完整 JSON），单独也尝试解析
 */
function parseSseEvents(chunk: string): SseParseResult {
  let confirmationDishes: ConfirmationDish[] | null = null;
  let errorMessage: string | null = null;
  let sawDone = false;

  // 统一换行符后按空行拆分事件块
  const blocks = chunk.replace(/\r\n/g, '\n').split('\n\n');
  for (const block of blocks) {
    if (!block.trim()) continue;
    let event = '';
    let dataLine = '';
    for (const line of block.split('\n')) {
      if (line.startsWith('event:')) event = line.slice(6).trim();
      else if (line.startsWith('data:')) dataLine += line.slice(5).trim();
    }
    if (!event) continue;

    if (event === 'Done') {
      sawDone = true;
      continue;
    }
    if (event === 'Error') {
      if (dataLine && !errorMessage) {
        try {
          const e = JSON.parse(dataLine) as {
            error_message?: string;
            error_code?: number;
          };
          errorMessage = e.error_message || `工作流报错(code=${e.error_code})`;
        } catch {
          errorMessage = '工作流执行报错';
        }
      }
      continue;
    }
    if (event !== 'Message' || !dataLine) continue;

    let msg: SseMessageData;
    try {
      msg = JSON.parse(dataLine) as SseMessageData;
    } catch {
      continue;
    }
    if (typeof msg.content !== 'string') continue;

    // 单条 content 直接尝试（结束节点的汇总消息通常是完整 JSON）
    const fromSingle = dishesFromContent(msg.content);
    if (fromSingle) confirmationDishes = fromSingle;
  }
  return { confirmationDishes, errorMessage, sawDone };
}

/**
 * 从完整 SSE 文本中稳健提取 confirmation_dishes。
 * 分两轮：
 *  1) 逐事件解析（命中汇总消息即可）
 *  2) 若未命中，把所有 Message 的 content 按 node_title 分组拼接后再解析
 *     （应对输出被拆成多个 node_is_finish=false 的分片）
 */
function extractDishesFromSse(fullText: string): SseExtractResult {
  const first = parseSseEvents(fullText);
  let dishes = first.confirmationDishes;
  const errorMessage = first.errorMessage;
  const sawDone = first.sawDone;

  if (!dishes) {
    // 第二轮：按节点分组拼接 content
    const byNode = new Map<string, string>();
    const blocks = fullText.replace(/\r\n/g, '\n').split('\n\n');
    for (const block of blocks) {
      if (!block.includes('event: Message')) continue;
      let dataLine = '';
      for (const line of block.split('\n')) {
        if (line.startsWith('data:')) dataLine += line.slice(5).trim();
      }
      if (!dataLine) continue;
      try {
        const msg = JSON.parse(dataLine) as SseMessageData;
        if (typeof msg.content !== 'string') continue;
        const key = msg.node_title || 'default';
        byNode.set(key, (byNode.get(key) || '') + msg.content);
      } catch {
        // 忽略非法分片
      }
    }
    for (const joined of byNode.values()) {
      const found = dishesFromContent(joined);
      if (found) {
        dishes = found;
        break;
      }
    }
  }
  return { dishes, errorMessage, sawDone };
}

export async function POST(request: Request) {
  debugLog('===== 收到新请求 =====');
  /* 1. 服务端读取配置（不下发、不打印） */
  const token = process.env.COZE_API_TOKEN;
  const workflowId = process.env.COZE_WORKFLOW1_ID;
  const appId = process.env.COZE_APP_ID;

  const missing: string[] = [];
  if (!token) missing.push('COZE_API_TOKEN');
  if (!workflowId) missing.push('COZE_WORKFLOW1_ID');
  if (!appId) missing.push('COZE_APP_ID');
  if (missing.length > 0) {
    return fail('服务端缺少必需的环境变量', 500, 'config', missing);
  }

  /* 2. 解析并校验请求体 */
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return fail('请求体不是合法 JSON', 400, 'request');
  }
  if (typeof body !== 'object' || body === null) {
    return fail('请求体必须是 JSON 对象', 400, 'request');
  }
  const obj = body as Record<string, unknown>;
  if (typeof obj.meal_image !== 'string' || !obj.meal_image) {
    return fail('meal_image 必须是图片 dataURL 字符串', 400, 'request');
  }
  if (
    typeof obj.daily_target_kcal !== 'number' ||
    !Number.isFinite(obj.daily_target_kcal)
  ) {
    return fail('daily_target_kcal 必须是有限数字', 400, 'request');
  }
  // daily_target_kcal 不由工作流 1 消费（其开始节点只有 meal_image），
  // 仅作为前端成功写入 sessionStorage 的载荷一部分，这里只校验不转发。
  const requestBody = body as Workflow1RequestBody;

  const parsed = parseDataUrl(requestBody.meal_image);
  if (!parsed) {
    return fail('meal_image 不是受支持的图片 dataURL（jpeg/jpg/png）', 400, 'request');
  }

  /* 3. 上传图片到 Coze files/upload，取 data.id 作为 file_id */
  let fileId: string;
  let uploadElapsedMs = 0;
  const uploadStartedAt = Date.now();
  try {
    const form = new FormData();
    // 用 Uint8Array 拷贝出标准 ArrayBufferView，避免 Buffer<ArrayBufferLike> 与 BlobPart 的类型冲突
    const bytes = new Uint8Array(parsed.buffer);
    form.append(
      'file',
      new Blob([bytes], { type: parsed.mime }),
      `meal.${parsed.extension}`
    );

    const uploadRes = await fetch(COZE_FILE_UPLOAD_URL, {
      method: 'POST',
      headers: {
        // 不设置 Content-Type：由 fetch 自动生成带 boundary 的 multipart/form-data
        Authorization: `Bearer ${token}`,
      },
      body: form,
      signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
      cache: 'no-store',
    });

    let uploadPayload: CozeUploadResponse;
    try {
      uploadPayload = (await uploadRes.json()) as CozeUploadResponse;
    } catch {
      return fail('Coze 文件上传接口返回的不是合法 JSON', 502, 'upload');
    }
    if (!uploadRes.ok || uploadPayload.code !== 0) {
      return fail('图片上传到 Coze 失败', 502, 'upload');
    }
    if (
      !uploadPayload.data ||
      typeof uploadPayload.data.id !== 'string' ||
      !uploadPayload.data.id
    ) {
      return fail('图片上传成功但未返回 file_id', 502, 'upload');
    }
    fileId = uploadPayload.data.id;
    uploadElapsedMs = Date.now() - uploadStartedAt;
    debugLog(`图片上传成功 耗时=${uploadElapsedMs}ms file_id已获取`);
  } catch (err) {
    const isTimeout = err instanceof Error && err.name === 'TimeoutError';
    return fail(
      isTimeout ? '图片上传到 Coze 超时' : '图片上传时发生网络错误',
      504,
      'upload'
    );
  }

  /* 4. 调用 workflow/stream_run（SSE 流式）。meal_image 用 JSON 序列化字符串传 file_id */
  debugLog('开始调用工作流1流式接口...');
  const runStartedAt = Date.now();
  let workflowElapsedMs = 0;
  let sseText = '';
  try {
    const runRes = await fetch(COZE_WORKFLOW_STREAM_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        workflow_id: workflowId,
        app_id: appId,
        parameters: {
          meal_image: JSON.stringify({ file_id: fileId }),
        },
      }),
      signal: AbortSignal.timeout(WORKFLOW_TIMEOUT_MS),
      cache: 'no-store',
    });

    if (!runRes.ok) {
      return fail(`工作流 1 流式接口请求失败(HTTP ${runRes.status})`, 502, 'workflow');
    }
    if (!runRes.body) {
      return fail('工作流 1 未返回流式数据', 502, 'workflow');
    }

    // 逐块读取 SSE 流并累积文本
    const reader = runRes.body.getReader();
    const decoder = new TextDecoder();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      sseText += decoder.decode(value, { stream: true });
    }
    sseText += decoder.decode();
    workflowElapsedMs = Date.now() - runStartedAt;
    debugLog(`流式工作流耗时 ${workflowElapsedMs}ms`);
  } catch (err) {
    const isTimeout = err instanceof Error && err.name === 'TimeoutError';
    return fail(
      isTimeout ? '工作流 1 调用超时' : '工作流 1 调用时发生网络错误',
      504,
      'workflow'
    );
  }

  /* 4.5 从 SSE 提取 Coze 调试链接与执行 ID，写入日志供随时查看 */
  const debugInfo = extractDebugInfo(sseText);
  if (debugInfo.debugUrl) {
    debugLog(`debug_url=${debugInfo.debugUrl}`);
  }
  if (debugInfo.executeId) {
    debugLog(`execute_id=${debugInfo.executeId}`);
  }
  if (!debugInfo.debugUrl) {
    debugLog('本次 SSE 未包含 debug_url（可在扣子控制台运行历史中查看）');
  }

  /* 5. 解析 SSE，提取 confirmation_dishes */
  const { dishes, errorMessage, sawDone } = extractDishesFromSse(sseText);
  if (errorMessage) {
    return fail(`工作流执行失败：${errorMessage}`, 502, 'workflow');
  }
  if (!dishes) {
    return fail(
      sawDone
        ? '工作流已结束但未返回有效的 confirmation_dishes'
        : '工作流未在流中返回确认数据（未收到 Done）',
      502,
      'parse'
    );
  }

  /* 6. 写开发者调试记录（结构化、与前端数据链路完全无关） */
  writeRunRecord({
    time: new Date().toISOString(),
    stage: 'success',
    upload_ms: uploadElapsedMs,
    workflow_ms: workflowElapsedMs,
    ...(debugInfo.executeId ? { execute_id: debugInfo.executeId } : {}),
    ...(debugInfo.debugUrl ? { debug_url: debugInfo.debugUrl } : {}),
  });

  /* 7. 返回菜品数据 + 本次执行的调试元信息；其它内容与敏感信息一律不返回 */
  const success: Workflow1RouteResponse = {
    success: true,
    confirmation_dishes: dishes,
    ...(debugInfo.debugUrl ? { debug_url: debugInfo.debugUrl } : {}),
    ...(debugInfo.executeId ? { execute_id: debugInfo.executeId } : {}),
    upload_ms: uploadElapsedMs,
    workflow_ms: workflowElapsedMs,
  };
  return NextResponse.json(success, { status: 200 });
}
