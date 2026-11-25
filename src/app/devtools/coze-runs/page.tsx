import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * 开发者专用调试页（不在任何用户流程内、robots 已禁止抓取）。
 * 分区读取服务端每次调用的追加记录：
 *   - workflow1-runs.jsonl：工作流 1（识别）
 *   - workflow2-runs.jsonl：工作流 2（计算）
 * 只展示元信息，不含 Token、图片、菜品或计算结果。
 */

export const dynamic = 'force-dynamic'; // 每次访问都读最新日志，不缓存

interface RunRecord {
  time: string;
  stage: 'success' | 'error';
  error?: string;
  // 工作流 1 分阶段耗时
  upload_ms?: number;
  workflow_ms?: number;
  // 工作流 2 总耗时
  elapsed_ms?: number;
  // 两者共有元信息
  code?: number;
  msg?: string;
  execute_id?: string;
  debug_url?: string;
}

function loadRecords(file: string): RunRecord[] {
  const full = path.join(process.cwd(), file);
  try {
    const text = readFileSync(full, 'utf8');
    return text
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.startsWith('{'))
      .map((line) => {
        try {
          return JSON.parse(line) as RunRecord;
        } catch {
          return null;
        }
      })
      .filter((r): r is RunRecord => r !== null)
      .reverse(); // 最新在前
  } catch {
    return [];
  }
}

function fmtMs(ms?: number): string {
  return typeof ms === 'number' && Number.isFinite(ms)
    ? `${(ms / 1000).toFixed(2)}s`
    : '—';
}

function fmtTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleString('zh-CN', { hour12: false });
}

const CARD = {
  background: '#fff',
  border: '1px solid #e2e8e4',
  borderRadius: 12,
  padding: '16px 18px',
};

function RecordCard({ r, kind }: { r: RunRecord; kind: 1 | 2 }) {
  const failed = r.stage === 'error' || (typeof r.code === 'number' && r.code !== 0);
  const total =
    kind === 1
      ? fmtMs((r.upload_ms ?? 0) + (r.workflow_ms ?? 0))
      : fmtMs(r.elapsed_ms);

  return (
    <div style={CARD}>
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: '6px 18px',
          fontSize: 13,
          marginBottom: r.debug_url || failed ? 12 : 0,
        }}
      >
        <span>🕒 {fmtTime(r.time)}</span>
        {kind === 1 ? (
          <>
            <span>上传 {fmtMs(r.upload_ms)}</span>
            <span>工作流 {fmtMs(r.workflow_ms)}</span>
          </>
        ) : null}
        <span>{kind === 1 ? '合计' : '耗时'} {total}</span>
        {typeof r.code === 'number' && (
          <span style={failed ? { color: '#b42318' } : { color: '#2e7d4f' }}>
            code {r.code}
          </span>
        )}
        {r.execute_id && <span>ID {r.execute_id}</span>}
        {failed && (
          <span style={{ color: '#b42318' }}>
            {r.error || r.msg || '执行未成功'}
          </span>
        )}
      </div>
      {r.debug_url ? (
        <a
          href={r.debug_url}
          target="_blank"
          rel="noopener noreferrer"
          style={{ fontSize: 13, color: '#2e7d4f', wordBreak: 'break-all' }}
        >
          查看本次工作流调试详情 ↗
          <br />
          <span style={{ fontSize: 11, color: '#63706a' }}>{r.debug_url}</span>
        </a>
      ) : failed ? null : (
        <span style={{ fontSize: 12, color: '#b42318' }}>
          本次未返回调试链接（可到扣子控制台运行历史查看）
        </span>
      )}
    </div>
  );
}

function Section({
  title,
  source,
  hint,
  records,
  kind,
}: {
  title: string;
  source: string;
  hint: string;
  records: RunRecord[];
  kind: 1 | 2;
}) {
  return (
    <section style={{ marginBottom: 32 }}>
      <h2 style={{ fontSize: 17, marginBottom: 6 }}>{title}</h2>
      <p style={{ fontSize: 12, color: '#63706a', marginBottom: 16 }}>
        数据源：{source} ｜ {hint}
      </p>
      {records.length === 0 ? (
        <div
          style={{
            ...CARD,
            fontSize: 14,
            color: '#63706a',
          }}
        >
          暂无记录。完成一次对应操作后，这里会出现本次调用的详情。
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {records.map((r, i) => (
            <RecordCard
              key={`${r.execute_id ?? 'run'}-${r.time}-${i}`}
              r={r}
              kind={kind}
            />
          ))}
        </div>
      )}
    </section>
  );
}

export default function CozeRunsPage() {
  const wf1 = loadRecords('workflow1-runs.jsonl');
  const wf2 = loadRecords('workflow2-runs.jsonl');

  return (
    <div
      style={{
        minHeight: '100vh',
        background: '#f5f7f8',
        color: '#1f2a24',
        fontFamily:
          'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace',
        padding: '32px 20px',
      }}
    >
      <div style={{ maxWidth: 980, margin: '0 auto' }}>
        <h1 style={{ fontSize: 20, marginBottom: 6 }}>
          Coze 工作流调用记录（开发者专用）
        </h1>
        <p style={{ fontSize: 12, color: '#63706a', marginBottom: 28 }}>
          调试链接由 Coze 生成，有效期 7 天 ｜ 此页不在用户流程中、robots 已禁止抓取
        </p>

        <Section
          title="工作流 1 · 图片识别"
          source="workflow1-runs.jsonl"
          hint="每次「开始识别」成功追加一条，含图片上传与工作流分阶段耗时"
          records={wf1}
          kind={1}
        />
        <Section
          title="工作流 2 · 热量计算"
          source="workflow2-runs.jsonl"
          hint="每次「确认并计算」追加一条，含返回码、耗时与调试链接"
          records={wf2}
          kind={2}
        />
      </div>
    </div>
  );
}
