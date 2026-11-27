/**
 * 浏览器端 Coze 调用记录（localStorage 持久化）。
 *
 * 背景：服务端的 workflow1/2-runs.jsonl 依赖可写文件系统，
 * 在 Vercel 等 Serverless 环境（只读文件系统）上无法写入，
 * /devtools/coze-runs 页因此读不到记录。
 *
 * 本模块改为：前端在每次 /api/coze/workflow1|2 调用完成后，
 * 把 Route 响应中已携带的调试元信息（debug_url / execute_id / 耗时 /
 * code / msg）追加进本浏览器的 localStorage；/devtools/coze-runs 页
 * 从同一浏览器读取展示。本地开发与线上行为一致。
 *
 * 安全约束：只记录时间/耗时/执行 ID/调试链接等元信息，
 * 绝不含 Token、图片数据或菜品内容（与原 jsonl 口径一致）。
 */

export interface CozeRunRecord {
  /** ISO 时间戳 */
  time: string;
  stage: 'success' | 'error';
  /** 失败时的可读原因（来自服务端 error / msg） */
  error?: string;
  /* ---- 工作流 1 分阶段耗时 ---- */
  upload_ms?: number;
  workflow_ms?: number;
  /* ---- 工作流 2 总耗时 ---- */
  elapsed_ms?: number;
  /* ---- 两者共有的元信息 ---- */
  code?: number;
  msg?: string;
  execute_id?: string;
  debug_url?: string;
}

/** 本页不在用户流程内；键名加前缀避免与业务载荷混淆 */
const STORAGE_KEY = 'calorie_coze_runs_v1';
/** 每个工作流最多保留的记录条数（最新在前），防止 localStorage 无限膨胀 */
const MAX_PER_KIND = 50;

interface CozeRunsStore {
  wf1: CozeRunRecord[];
  wf2: CozeRunRecord[];
}

function readStore(): CozeRunsStore {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { wf1: [], wf2: [] };
    const parsed = JSON.parse(raw) as Partial<CozeRunsStore>;
    return {
      wf1: Array.isArray(parsed.wf1) ? parsed.wf1 : [],
      wf2: Array.isArray(parsed.wf2) ? parsed.wf2 : [],
    };
  } catch {
    return { wf1: [], wf2: [] };
  }
}

function writeStore(store: CozeRunsStore): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    // 存储不可用（配额/隐私模式）：调试记录失败不影响业务流程
  }
}

/**
 * 追加一条调用记录。kind=1 工作流 1（识别），kind=2 工作流 2（计算）。
 * 记录写入失败绝不抛错、绝不影响主流程。
 */
export function appendCozeRun(kind: 1 | 2, record: CozeRunRecord): void {
  if (typeof window === 'undefined') return;
  const store = readStore();
  const list = kind === 1 ? store.wf1 : store.wf2;
  const next = [record, ...list].slice(0, MAX_PER_KIND);
  writeStore(kind === 1 ? { ...store, wf1: next } : { ...store, wf2: next });
}

/** 读取全部记录（均为最新在前）。仅在客户端组件中使用。 */
export function loadCozeRuns(): CozeRunsStore {
  return readStore();
}

/** 清空全部记录 */
export function clearCozeRuns(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // 忽略
  }
}
