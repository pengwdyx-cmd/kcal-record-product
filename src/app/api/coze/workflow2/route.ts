import { NextResponse } from 'next/server';
import { appendFileSync } from 'node:fs';
import path from 'node:path';
import type { ConfirmationDish } from '@/app/confirm/confirm-data';

/* ================================================================== */
/*  服务端 API Route｜调用 Coze 国内版工作流 2（同步、非流式）             */
/*                                                                    */
/*  官方文档（核对日期 2026-11-23）：                                    */
/*    https://www.coze.cn/open/docs/developer_guides/workflow_run       */
/*    POST https://api.coze.cn/v1/workflow/run                          */
/*    Header: Authorization: Bearer <token> / Content-Type: application/json */
/*    Body: workflow_id(必填), parameters(对象), app_id(应用内工作流),     */
/*          is_async(false=同步)                                        */
/*    返回: code=0 表示调用成功; data 通常为 JSON 序列化字符串           */
/*                                                                    */
/*  安全约束：                                                          */
/*    - Token 仅在本文件（服务端）读取，绝不下发前端、绝不打印            */
/*    - 只接受 daily_target_kcal 与 confirmation_dishes 两个参数          */
/*    - 不接收、不转发 meal_image                                        */
/*    - 不改动 confirmation_dishes 的内部结构，原样透传                   */
/* ================================================================== */

/** 请求体：与工作流 2 开始节点的两个入参一一对应 */
interface Workflow2RequestBody {
  daily_target_kcal: number;
  confirmation_dishes: ConfirmationDish[];
}

/** Coze workflow/run 的原始响应（仅声明本 Route 需要透传的字段） */
interface CozeWorkflowRunResponse {
  code: number;
  msg?: string;
  data?: string;
  debug_url?: string;
  execute_id?: string;
  usage?: {
    input_count?: number;
    token_count?: number;
    output_count?: number;
  };
  detail?: { logid?: string };
}

const COZE_WORKFLOW_RUN_URL = 'https://api.coze.cn/v1/workflow/run';
/** 非流式接口 90s 无响应会断开，这里给上游调用留 60s 超时 */
const UPSTREAM_TIMEOUT_MS = 60_000;

/**
 * 开发者专用：每次调用追加一条结构化记录到 workflow2-runs.jsonl。
 * 只记录时间/耗时/返回码/执行 ID/调试链接等元信息，
 * 绝不含 Token、daily_target_kcal、confirmation_dishes 或任何计算结果。
 * 写日志失败不影响业务。
 */
const RUNS_LOG_PATH = path.join(process.cwd(), 'workflow2-runs.jsonl');
interface Workflow2RunRecord {
  time: string;
  stage: 'success' | 'error';
  elapsed_ms: number;
  code?: number;
  msg?: string;
  execute_id?: string;
  debug_url?: string;
  error?: string;
}
function writeRunRecord(record: Workflow2RunRecord) {
  try {
    appendFileSync(RUNS_LOG_PATH, JSON.stringify(record) + '\n', 'utf8');
  } catch {
    // 忽略：调试日志不可写不影响业务
  }
}

/**
 * 校验请求体。返回null表示合法，否则返回错误说明。
 * confirmation_dishes 内部结构由前端契约保证，这里只校验顶层是数组，不改写内容。
 */
function validateBody(body: unknown): string | null {
  if (typeof body !== 'object' || body === null) {
    return '请求体必须是 JSON 对象';
  }
  const obj = body as Record<string, unknown>;
  if (
    typeof obj.daily_target_kcal !== 'number' ||
    !Number.isFinite(obj.daily_target_kcal)
  ) {
    return 'daily_target_kcal 必须是有限数字';
  }
  if (!Array.isArray(obj.confirmation_dishes)) {
    return 'confirmation_dishes 必须是数组';
  }
  return null;
}

export async function POST(request: Request) {
  /* 1. 服务端读取配置（不下发、不打印） */
  const token = process.env.COZE_API_TOKEN;
  const workflowId = process.env.COZE_WORKFLOW2_ID;
  const appId = process.env.COZE_APP_ID;

  const missing: string[] = [];
  if (!token) missing.push('COZE_API_TOKEN');
  if (!workflowId) missing.push('COZE_WORKFLOW2_ID');
  if (!appId) missing.push('COZE_APP_ID');
  if (missing.length > 0) {
    // 只返回缺失的变量名，绝不输出其值
    return NextResponse.json(
      { error: '服务端缺少必需的环境变量', missing },
      { status: 500 }
    );
  }

  /* 2. 解析并校验请求体 */
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: '请求体不是合法 JSON' }, { status: 400 });
  }
  const validationError = validateBody(body);
  if (validationError) {
    return NextResponse.json({ error: validationError }, { status: 400 });
  }
  const { daily_target_kcal, confirmation_dishes } = body as Workflow2RequestBody;

  /* 3. 调用 Coze workflow/run（同步非流式）。只传两个参数，不传 meal_image */
  let upstream: CozeWorkflowRunResponse;
  const startedAt = Date.now();
  try {
    const res = await fetch(COZE_WORKFLOW_RUN_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        workflow_id: workflowId,
        app_id: appId,
        is_async: false,
        parameters: {
          daily_target_kcal,
          confirmation_dishes,
        },
      }),
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      cache: 'no-store',
    });

    try {
      upstream = (await res.json()) as CozeWorkflowRunResponse;
    } catch {
      writeRunRecord({
        time: new Date().toISOString(),
        stage: 'error',
        elapsed_ms: Date.now() - startedAt,
        error: 'Coze 上游返回的不是合法 JSON',
      });
      return NextResponse.json(
        { error: 'Coze 上游返回的不是合法 JSON', upstreamStatus: res.status },
        { status: 502 }
      );
    }

    /* 4. 写开发者调试记录（元信息，与前端数据链路完全无关） */
    writeRunRecord({
      time: new Date().toISOString(),
      stage: upstream.code === 0 ? 'success' : 'error',
      elapsed_ms: Date.now() - startedAt,
      code: upstream.code,
      ...(upstream.msg ? { msg: upstream.msg } : {}),
      ...(upstream.execute_id ? { execute_id: upstream.execute_id } : {}),
      ...(upstream.debug_url ? { debug_url: upstream.debug_url } : {}),
    });

    /* 5. 透传原始响应；用 HTTP 200 承载 code!=0 的业务失败，让前端能读到 msg/data */
    return NextResponse.json(upstream, { status: 200 });
  } catch (err) {
    const isTimeout = err instanceof Error && err.name === 'TimeoutError';
    const message = isTimeout
      ? `调用 Coze 工作流超时（${UPSTREAM_TIMEOUT_MS / 1000}s）`
      : '调用 Coze 工作流时发生网络错误';
    writeRunRecord({
      time: new Date().toISOString(),
      stage: 'error',
      elapsed_ms: Date.now() - startedAt,
      error: message,
    });
    // 不打印 err 详情，避免某些错误对象携带请求头（含 Token）
    return NextResponse.json({ error: message }, { status: 504 });
  }
}
