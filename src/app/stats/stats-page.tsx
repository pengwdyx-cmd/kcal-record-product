/* eslint-disable @next/next/no-img-element */
'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { fmtKcal } from '../result/result-data';
import {
  catMessage,
  catSrc,
  defaultCatId,
  formatDateLabel,
  formatTime,
  loadHistory,
  localDateKey,
  todayRecords,
  weekDays,
  type MealRecord,
} from './history';
import {
  buildDemoRecords,
  DEMO_MAX_MEALS,
  DEMO_MEALS,
  DEMO_TARGET_KCAL,
} from './demo-data';

/* ================================================================== */
/*  统计页｜今日日期 + 实际摄入 + 左右交替时间线                        */
/*  数据全部来自本机历史（工作流 2 真实结果与用户上传图片）              */
/* ================================================================== */

interface StatsState {
  now: Date;
  history: MealRecord[];
  /** URL 带 ?demo=1 时用内置虚拟数据，仅用于效果核对 */
  demo: boolean;
  demoCount: number;
}

export default function StatsPage() {
  const router = useRouter();
  /** SSR 首屏不读 localStorage，客户端挂载后再注入，避免 hydration 不一致 */
  const [state, setState] = useState<StatsState | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const demo = params.get('demo') === '1';
    const rawCount = Number(params.get('meals'));
    const demoCount =
      Number.isFinite(rawCount) && rawCount >= 1
        ? Math.min(DEMO_MAX_MEALS, Math.floor(rawCount))
        : 3;
    const now = new Date();
    setState({
      now,
      history: demo ? buildDemoRecords(now, demoCount) : loadHistory(),
      demo,
      demoCount,
    });
  }, []);

  const handleAddMeal = useCallback(() => {
    router.push('/');
  }, [router]);

  if (!state) {
    return (
      <div className="min-h-screen" style={{ backgroundColor: 'var(--page-bg)' }}>
        <div className="max-w-lg mx-auto px-4 pt-8">
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
            正在读取记录…
          </p>
        </div>
      </div>
    );
  }

  const { now, history, demo, demoCount } = state;
  const today = todayRecords(history, now);
  const totalKcal = Math.round(today.reduce((sum, r) => sum + r.kcal, 0));
  const target = today.find((r) => r.daily_target_kcal !== null)?.daily_target_kcal ?? null;
  const ratio = target && target > 0 ? Math.min(1, totalKcal / target) : 0;

  return (
    <div className="min-h-screen" style={{ backgroundColor: 'var(--page-bg)' }}>
      <div className="max-w-lg mx-auto px-4 pt-6 sm:pt-8 pb-32">
        {/* Brand Header：与上传页 / 确认页 / 结果页一致 */}
        <header className="flex items-center gap-2 mb-6">
          <Link href="/" className="flex items-center gap-2">
            <div
              className="w-8 h-8 rounded-lg flex items-center justify-center"
              style={{ backgroundColor: 'var(--brand-green)' }}
            >
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="white"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z" />
                <path d="M8 14s1.5 2 4 2 4-2 4-2" />
                <path d="M9 9h.01" />
                <path d="M15 9h.01" />
              </svg>
            </div>
            <span
              className="text-lg font-semibold"
              style={{ color: 'var(--brand-green)' }}
            >
              卡路里记录
            </span>
          </Link>
        </header>

        {/* 最上面：猫头趣味会话框，文案按今日餐数变化；猫图随每餐随机更换 */}
        <CatBubble
          message={catMessage(today.length)}
          catId={history[0]?.cat_id ?? defaultCatId(now)}
        />

        {/* 今天所在日期 */}
        <h1
          className="text-xl font-semibold mt-7"
          style={{ color: 'var(--text-primary)' }}
        >
          {formatDateLabel(now)}
        </h1>
        <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>
          今天的进食记录
        </p>

        {/* 周历：本周内哪天有记录就打点，数据来自本机历史 */}
        <WeekStrip now={now} history={history} />

        {/* 今日实际摄入 */}
        <section
          className="rounded-2xl p-5 mb-7"
          style={{
            backgroundColor: 'var(--card-bg)',
            boxShadow: 'var(--card-shadow)',
            borderRadius: '16px',
          }}
        >
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                今日实际摄入
              </p>
              <p
                className="text-4xl font-semibold mt-1"
                style={{ color: 'var(--brand-green)' }}
              >
                {fmtKcal(totalKcal)}{' '}
                <span
                  className="text-base font-normal"
                  style={{ color: 'var(--text-secondary)' }}
                >
                  kcal
                </span>
              </p>
              <p className="text-xs mt-3" style={{ color: 'var(--text-secondary)' }}>
                {target && target > 0
                  ? `目标 ${fmtKcal(target)} kcal · 已达成 ${Math.round(ratio * 100)}%`
                  : `今天共记录 ${today.length} 餐`}
              </p>
            </div>
            <ProgressRing ratio={ratio} />
          </div>
        </section>

        {/* 时间线：由近到远，一左一右 */}
        <section>
          <div className="flex items-baseline justify-between mb-5">
            <h2
              className="text-base font-semibold"
              style={{ color: 'var(--text-primary)' }}
            >
              最近记录
            </h2>
            <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>
              共 {history.length} 餐
            </span>
          </div>
          {history.length === 0 ? (
            <div
              className="rounded-2xl p-6 text-center text-sm"
              style={{
                backgroundColor: 'var(--card-bg)',
                boxShadow: 'var(--card-shadow)',
                borderRadius: '16px',
                color: 'var(--text-secondary)',
              }}
            >
              还没有记录，点右下角的加号拍下第一餐吧。
            </div>
          ) : (
            <Timeline records={history} />
          )}
        </section>

        {/* 演示模式下把虚拟数据与记录的餐食逐条写出来，方便核对效果 */}
        {demo && (
          <DemoDataCard
            now={now}
            history={history}
            demoCount={demoCount}
            totalKcal={totalKcal}
            target={target}
          />
        )}
      </div>

      {/* 悬浮加号：跳上传页新增餐食，位置跟随内容列右侧 */}
      <div className="fixed bottom-0 left-0 right-0 z-40 pointer-events-none">
        <div className="max-w-lg mx-auto px-4 pb-7 flex justify-end">
          <button
            type="button"
            onClick={handleAddMeal}
            aria-label="新增餐食"
            className="pointer-events-auto w-14 h-14 rounded-full flex items-center justify-center transition-transform hover:scale-105"
            style={{
              backgroundColor: 'var(--brand-green)',
              color: '#ffffff',
              boxShadow: '0 6px 20px rgba(49, 92, 69, 0.32)',
            }}
          >
            <svg
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M12 5v14" />
              <path d="M5 12h14" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}

/* ================================================================== */
/*  Sub-components                                                     */
/* ================================================================== */

/** 猫头 + 对话气泡 */
function CatBubble({ message, catId }: { message: string; catId: number }) {
  return (
    <div className="flex items-end gap-3">
      <CatAvatar catId={catId} />
      <div
        className="relative flex-1 rounded-2xl p-4"
        style={{
          backgroundColor: 'var(--card-bg)',
          boxShadow: 'var(--card-shadow)',
          borderRadius: '16px',
        }}
      >
        {/* 气泡小尾巴 */}
        <span
          className="absolute -left-1 top-6 w-3 h-3 rotate-45"
          style={{ backgroundColor: 'var(--card-bg)' }}
        />
        <p className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>
          本猫有话说
        </p>
        <p
          className="text-sm leading-relaxed mt-1 relative"
          style={{ color: 'var(--text-primary)' }}
        >
          {message}
        </p>
      </div>
    </div>
  );
}

/** 猫头：用户提供的真实猫贴纸（public/cats/），每新增一餐随机换一只 */
function CatAvatar({ catId }: { catId: number }) {
  return (
    <div
      className="w-16 h-16 rounded-full flex-shrink-0 overflow-hidden flex items-center justify-center"
      style={{
        backgroundColor: '#ffffff',
        border: '1px solid #eef2ef',
        boxShadow: 'var(--card-shadow)',
      }}
    >
      <img
        src={catSrc(catId)}
        alt="今日值班猫"
        className="w-full h-full object-contain"
        style={{ padding: '3px' }}
      />
    </div>
  );
}

/** 周历条：周一到周日，今天高亮，有记录的日子打点 */
function WeekStrip({ now, history }: { now: Date; history: MealRecord[] }) {
  const labels = ['一', '二', '三', '四', '五', '六', '日'];
  const todayKey = localDateKey(now);
  const recordedDays = new Set(history.map((r) => r.date));
  return (
    <div className="flex justify-between my-5">
      {weekDays(now).map((d, i) => {
        const isToday = localDateKey(d) === todayKey;
        const hasRecord = recordedDays.has(localDateKey(d));
        return (
          <div key={i} className="flex flex-col items-center gap-1.5">
            <span className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>
              {isToday ? '今' : labels[i]}
            </span>
            <div
              className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-medium"
              style={{
                backgroundColor: isToday ? 'var(--brand-green)' : 'transparent',
                color: isToday ? '#ffffff' : 'var(--text-primary)',
              }}
            >
              {d.getDate()}
            </div>
            <span
              className="w-1.5 h-1.5 rounded-full"
              style={{
                backgroundColor: hasRecord ? 'var(--primary-green)' : 'transparent',
              }}
            />
          </div>
        );
      })}
    </div>
  );
}

/** 圆环进度：比例来自「今日摄入 / 目标」，无目标时不显示进度只保留碗 */
function ProgressRing({ ratio }: { ratio: number }) {
  const r = 32;
  const circumference = 2 * Math.PI * r;
  const pct = Math.min(1, Math.max(0, ratio));
  return (
    <svg width="88" height="88" viewBox="0 0 88 88" className="flex-shrink-0">
      <circle cx="44" cy="44" r={r} fill="none" stroke="#eef2ef" strokeWidth="8" />
      <circle
        cx="44"
        cy="44"
        r={r}
        fill="none"
        stroke="var(--primary-green)"
        strokeWidth="8"
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={circumference * (1 - pct)}
        transform="rotate(-90 44 44)"
      />
      {/* 小碗图标，呼应参考图的中心元素 */}
      <g transform="translate(44 46)">
        <path
          d="M-13 -2 h26 a13 13 0 0 1 -26 0 z"
          fill="var(--brand-green)"
        />
        <path
          d="M-16 -3 h32"
          stroke="var(--brand-green)"
          strokeWidth="2"
          strokeLinecap="round"
        />
        <path
          d="M-4 -9 c0 2 -2 3 -2 5 M4 -11 c0 2 -2 3 -2 5"
          fill="none"
          stroke="var(--brand-green)"
          strokeWidth="1.6"
          strokeLinecap="round"
          opacity="0.55"
        />
      </g>
    </svg>
  );
}

/** 时间线：中轴线 + 左右交替的餐食卡片 */
function Timeline({ records }: { records: MealRecord[] }) {
  return (
    <div className="relative mt-1">
      <div
        className="absolute left-1/2 top-2 bottom-2 w-px -translate-x-1/2"
        style={{ backgroundColor: '#dfe8e1' }}
      />
      <div className="flex flex-col gap-5">
        {records.map((record, index) => (
          <TimelineItem
            key={record.id}
            record={record}
            side={index % 2 === 0 ? 'left' : 'right'}
          />
        ))}
      </div>
    </div>
  );
}

function TimelineItem({
  record,
  side,
}: {
  record: MealRecord;
  side: 'left' | 'right';
}) {
  const d = new Date(record.created_at);
  const stamp = Number.isNaN(d.getTime())
    ? ''
    : `${d.getMonth() + 1}/${d.getDate()} ${formatTime(record.created_at)}`;
  const name = record.dish_labels.length > 0 ? record.dish_labels.join('、') : '未命名餐食';

  return (
    <div
      className="relative flex"
      style={{ justifyContent: side === 'left' ? 'flex-start' : 'flex-end' }}
    >
      {/* 中轴连接点 */}
      <span
        className="absolute left-1/2 top-7 -translate-x-1/2 z-20 w-3 h-3 rounded-full"
        style={{
          backgroundColor: 'var(--primary-green)',
          boxShadow: '0 0 0 3px var(--page-bg)',
        }}
      />
      {/* 横向连接线 */}
      <span
        className="absolute top-[31px] h-px w-[12%]"
        style={{
          ...(side === 'left' ? { right: '50%' } : { left: '50%' }),
          backgroundColor: '#dfe8e1',
        }}
      />
      <div className={`relative z-10 w-[46%] ${side === 'left' ? 'pr-1' : 'pl-1'}`}>
        <div
          className="rounded-xl p-2.5 flex items-center gap-2.5"
          style={{
            backgroundColor: 'var(--card-bg)',
            boxShadow: 'var(--card-shadow)',
          }}
        >
          <div
            className="w-12 h-12 rounded-lg overflow-hidden flex-shrink-0 flex items-center justify-center"
            style={{ backgroundColor: '#eef2ef' }}
          >
            {record.image ? (
              <img
                src={record.image}
                alt={name}
                className="w-full h-full object-cover"
              />
            ) : (
              <svg
                width="22"
                height="22"
                viewBox="0 0 24 24"
                fill="none"
                stroke="var(--text-secondary)"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M3 11h18a9 9 0 0 1 -18 0z" />
                <path d="M2 11h20" />
                <path d="M9 7c0-1.5-1-1.5-1-3 M14 7c0-1.5-1-1.5-1-3" />
              </svg>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <p
              className="text-xs font-medium leading-snug break-words"
              style={{ color: 'var(--text-primary)' }}
            >
              {name}
            </p>
            <p className="text-[10px] mt-0.5" style={{ color: 'var(--text-secondary)' }}>
              {stamp}
            </p>
            <p
              className="text-sm font-semibold mt-1"
              style={{ color: 'var(--brand-green)' }}
            >
              {fmtKcal(record.kcal)} kcal
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

/** 演示数据明细：仅 ?demo=1 时渲染，把虚拟数值与记录的餐食逐条写出来 */
function DemoDataCard({
  now,
  history,
  demoCount,
  totalKcal,
  target,
}: {
  now: Date;
  history: MealRecord[];
  demoCount: number;
  totalKcal: number;
  target: number | null;
}) {
  // 明细按时间正序（早 → 晚）列出，与上方时间线的「由近到远」互补
  const list = [...history].reverse();
  const pct = target && target > 0 ? Math.round((totalKcal / target) * 100) : null;
  return (
    <section
      className="mt-8 rounded-2xl p-4"
      style={{
        backgroundColor: '#f2f7f3',
        border: '1px solid #dce9df',
        borderRadius: '16px',
      }}
    >
      <p className="text-xs font-semibold" style={{ color: 'var(--brand-green)' }}>
        演示数据 · 仅用于核对效果
      </p>
      <p
        className="text-[11px] mt-1 leading-relaxed"
        style={{ color: 'var(--text-secondary)' }}
      >
        以下是写死的虚拟餐食，不会写入本机历史；真实记录请打开不带 ?demo=1 的 /stats。
        演示模式下猫图编号固定，方便核对「每加一餐换一只」；真实流程每次新增都随机抽取且不与上一餐重复。
      </p>
      <p className="text-xs mt-3" style={{ color: 'var(--text-primary)' }}>
        {formatDateLabel(now)} · 每日目标 {fmtKcal(target ?? DEMO_TARGET_KCAL)} kcal
      </p>

      <div className="mt-2 flex flex-col gap-1.5">
        {list.map((r, i) => (
          <div
            key={r.id}
            className="flex items-start gap-2 text-[11px] leading-relaxed"
          >
            <span
              className="flex-shrink-0 tabular-nums"
              style={{ color: 'var(--text-secondary)' }}
            >
              {formatTime(r.created_at)}
            </span>
            <span className="flex-1" style={{ color: 'var(--text-primary)' }}>
              {DEMO_MEALS[i]?.meal_name ?? '餐食'}：{r.dish_labels.join('、')}
              <span className="ml-1 font-semibold" style={{ color: 'var(--brand-green)' }}>
                {fmtKcal(r.kcal)} kcal
              </span>
              <span className="ml-1" style={{ color: 'var(--text-secondary)' }}>
                （区间 {fmtKcal(r.kcal_min)}–{fmtKcal(r.kcal_max)}）
              </span>
            </span>
            <span className="flex-shrink-0" style={{ color: 'var(--text-secondary)' }}>
              猫 #{r.cat_id}
            </span>
          </div>
        ))}
      </div>

      <p className="text-xs mt-3" style={{ color: 'var(--text-primary)' }}>
        今日合计{' '}
        <span className="font-semibold" style={{ color: 'var(--brand-green)' }}>
          {fmtKcal(totalKcal)} kcal
        </span>
        {pct !== null ? ` · 达成 ${pct}%` : ''} · 共 {history.length} 餐
      </p>

      <div className="mt-3 flex items-center gap-2 flex-wrap">
        <span className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>
          切换餐数：
        </span>
        {Array.from({ length: DEMO_MAX_MEALS }, (_, i) => i + 1).map((n) => (
          <Link
            key={n}
            href={`/stats?demo=1&meals=${n}`}
            className="text-[11px] px-2 py-1 rounded-full"
            style={{
              backgroundColor: n === demoCount ? 'var(--brand-green)' : '#ffffff',
              color: n === demoCount ? '#ffffff' : 'var(--text-primary)',
              border: '1px solid #dce9df',
            }}
          >
            {n} 餐
          </Link>
        ))}
        <Link
          href="/stats"
          className="text-[11px] underline ml-auto"
          style={{ color: 'var(--primary-green)' }}
        >
          查看真实记录
        </Link>
      </div>
    </section>
  );
}
