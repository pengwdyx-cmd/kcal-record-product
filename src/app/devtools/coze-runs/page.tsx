'use client';

import { useEffect, useState } from 'react';
import {
  clearCozeRuns,
  loadCozeRuns,
  type CozeRunRecord,
} from '@/lib/coze-runs';

/**
 * 开发者专用调试页（不在任何用户流程内、robots 已禁止抓取）。
 * 数据源：本浏览器的 localStorage（calorie_coze_runs_v1）——
 * 服务端 jsonl 依赖可写文件系统，在 Vercel 等 Serverless 环境不可用，
 * 故改为前端在每次 workflow1/2 调用完成后记录元信息，本页从浏览器读取。
 * 只展示元信息，不含 Token、图片、菜品或计算结果。
 */

interface RunsStore {
  wf1: CozeRunRecord[];
  wf2: CozeRunRecord[];
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

function RecordCard({ r, kind }: { r: CozeRunRecord; kind: 1 | 2 }) {
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
  records: CozeRunRecord[];
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
  /** 首帧渲染空态，挂载后从本浏览器读取，避免 SSR 与 localStorage 不同步 */
  const [runs, setRuns] = useState<RunsStore>({ wf1: [], wf2: [] });

  useEffect(() => {
    const store = loadCozeRuns();
    setRuns({ wf1: store.wf1, wf2: store.wf2 });
  }, []);

  const handleClear = () => {
    clearCozeRuns();
    setRuns({ wf1: [], wf2: [] });
  };

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
        <p style={{ fontSize: 12, color: '#63706a', marginBottom: 8 }}>
          调试链接由 Coze 生成，有效期 7 天 ｜ 此页不在用户流程中、robots 已禁止抓取
        </p>
        <p style={{ fontSize: 12, color: '#63706a', marginBottom: 20 }}>
          记录保存在当前浏览器（localStorage），换浏览器或清除站点数据后不互通；
          记录上限每个工作流 50 条，超出自动淘汰最旧。
          <button
            type="button"
            onClick={handleClear}
            style={{
              marginLeft: 10,
              fontSize: 12,
              color: '#b42318',
              background: 'transparent',
              border: '1px solid #e2b4b0',
              borderRadius: 6,
              padding: '2px 10px',
              cursor: 'pointer',
            }}
          >
            清空记录
          </button>
        </p>

        <Section
          title="工作流 1 · 图片识别"
          source="浏览器 localStorage"
          hint="每次「开始识别」成功追加一条，含图片上传与工作流分阶段耗时"
          records={runs.wf1}
          kind={1}
        />
        <Section
          title="工作流 2 · 热量计算"
          source="浏览器 localStorage"
          hint="每次「确认并计算」追加一条，含返回码、耗时与调试链接"
          records={runs.wf2}
          kind={2}
        />
      </div>
    </div>
  );
}
