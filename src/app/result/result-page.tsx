'use client';

import { useState, useCallback, useEffect, useRef, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  CONFIRM_INPUT_STORAGE_KEY,
} from '../confirm/confirm-data';
import { saveCurrentMeal } from '../stats/history';
import {
  RESULT_STORAGE_KEY,
  parseResultData,
  getResultStatus,
  fmtKcal,
  progressWidth,
  type ResultPageInput,
  type Workflow2ResultData,
  type ResultDish,
  type ResultIngredient,
  type ResultStatus,
} from './result-data';

/* ================================================================== */
/*  Props：SSR 占位 + 客户端用 sessionStorage 覆盖（与确认页同一模式）    */
/* ================================================================== */

interface ResultPageProps {
  /** SSR 首屏占位；真实值由客户端挂载后从 sessionStorage 读取 */
  initialInput: ResultPageInput | null;
}

const RANGE_TIP =
  '这是根据当前已记录餐食的热量区间计算出的范围，中位值为区间的中间值。由于食材重量和烹饪油量存在估算范围，因此热量结果也会存在区间。';

/** 计算依据：由每个菜品 kcal 右上角的问号承载，内容与原独立卡片一致 */
const BASIS_CONTENT: ReactNode = (
  <span className="block">
    <span
      className="block text-xs font-medium mb-1.5"
      style={{ color: 'var(--text-primary)' }}
    >
      计算依据
    </span>
    <span className="block">食材热量参考《中国食物成分表》。</span>
    <span className="block mt-1">
      油量根据菜品烹饪方式进行区间估算，并按照 9 kcal/g 计算油脂热量。
    </span>
    <span className="block mt-1">最终热量 = 食材基础热量 + 油脂热量。</span>
  </span>
);

export default function ResultPage({ initialInput }: ResultPageProps) {
  const router = useRouter();
  const [input, setInput] = useState<ResultPageInput | null>(initialInput);
  /** 菜品展开状态：dish_id -> 是否展开 */
  const [expandedDishes, setExpandedDishes] = useState<ReadonlySet<string>>(
    () => new Set<string>()
  );
  /** 问号说明展开状态：key -> 是否显示（区间说明 / 计算依据共用） */
  const [openInfos, setOpenInfos] = useState<ReadonlySet<string>>(
    () => new Set<string>()
  );
  /** 反馈入口占位提示 */
  const [showToast, setShowToast] = useState(false);
  /** 防止「完成记录 / 新增餐食」重复点击写入两条历史 */
  const savingRef = useRef(false);

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(RESULT_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as ResultPageInput;
      if (parsed && typeof parsed === 'object' && parsed.raw) {
        setInput(parsed);
      }
    } catch {
      // 无有效载荷时保留 SSR 占位
    }
  }, []);

  const data = input ? parseResultData(input.raw?.data) : null;
  const status: ResultStatus | null = data ? getResultStatus(data) : null;

  const toggleIn = useCallback(
    (setter: React.Dispatch<React.SetStateAction<ReadonlySet<string>>>, key: string) => {
      setter((prev) => {
        const next = new Set(prev);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        return next;
      });
    },
    []
  );

  /** 全部失败：不留正常结果态，引导回确认页 */
  const handleBackToConfirm = useCallback(() => {
    router.replace('/confirm');
  }, [router]);

  /** 两个出口都先把本次餐食落进本机历史，统计页才有真实数据 */
  const persistThenGo = useCallback(
    async (target: '/' | '/stats') => {
      if (savingRef.current) return;
      savingRef.current = true;
      try {
        await saveCurrentMeal();
      } catch {
        // 存储失败不阻塞跳转
      }
      try {
        sessionStorage.removeItem(RESULT_STORAGE_KEY);
        sessionStorage.removeItem(CONFIRM_INPUT_STORAGE_KEY);
      } catch {
        // 存储不可用时忽略，跳转不受影响
      }
      router.push(target);
    },
    [router]
  );

  /** 新增餐食：记录本次餐食后回到上传页 */
  const handleAddMeal = useCallback(() => {
    void persistThenGo('/');
  }, [persistThenGo]);

  /** 完成记录：记录本次餐食后跳转到统计页 */
  const handleFinish = useCallback(() => {
    void persistThenGo('/stats');
  }, [persistThenGo]);

  return (
    <div
      className="min-h-screen flex flex-col"
      style={{ backgroundColor: 'var(--page-bg)' }}
    >
      <div className="flex-1 pb-24">
        <div className="max-w-lg mx-auto px-4 pt-6 sm:pt-8">
          {/* Brand Header：与前两页一致 */}
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

          {/* Step Progress Bar：第三步「查看结果」为当前步骤 */}
          <ResultStepBar />

          {!data || !status ? (
            <EmptyState onAddMeal={handleAddMeal} />
          ) : status === 'all_failed' ? (
            <AllFailedState data={data} onBack={handleBackToConfirm} />
          ) : (
            <>
              {/* 1. 今日汇总（最高视觉权重） */}
              <DailySummaryCard
                data={data}
                infoOpen={openInfos.has('daily')}
                onToggleInfo={() => toggleIn(setOpenInfos, 'daily')}
              />

              {/* 2. 本餐结果（次高视觉权重） */}
              <MealSummaryCard
                data={data}
                infoOpen={openInfos.has('meal')}
                onToggleInfo={() => toggleIn(setOpenInfos, 'meal')}
              />

              {/* 3. 菜品列表（默认摘要，点击展开） */}
              <div className="flex flex-col gap-3 mt-4">
                {data.result_dishes.map((dish) => (
                  <DishResultCard
                    key={dish.dish_id}
                    dish={dish}
                    expanded={expandedDishes.has(dish.dish_id)}
                    onToggle={() => toggleIn(setExpandedDishes, dish.dish_id)}
                    rangeInfoOpen={openInfos.has(`dish-range-${dish.dish_id}`)}
                    onToggleRangeInfo={() =>
                      toggleIn(setOpenInfos, `dish-range-${dish.dish_id}`)
                    }
                    basisOpen={openInfos.has(`dish-basis-${dish.dish_id}`)}
                    onToggleBasis={() =>
                      toggleIn(setOpenInfos, `dish-basis-${dish.dish_id}`)
                    }
                  />
                ))}
              </div>

              {/* 4. 失败菜品明细（存在 failed_dishes 时高亮，不隐藏原因） */}
              <FailedDishesSection data={data} />
            </>
          )}

          {/* 底部反馈：只保留「问题反馈」四个字的小号文字链接，不做成卡片或按钮 */}
          <div className="mt-7 mb-1 text-center">
            <a
              href="#"
              onClick={(event) => {
                event.preventDefault();
                setShowToast(true);
                setTimeout(() => setShowToast(false), 3000);
              }}
              className="text-xs underline"
              style={{ color: 'var(--text-secondary)' }}
            >
              问题反馈
            </a>
          </div>
        </div>
      </div>

      {/* 底部导航：与确认页完全一致的固定栏风格 */}
      <ResultBottomBar
        onAddMeal={handleAddMeal}
        onFinish={handleFinish}
      />

      {showToast && (
        <div
          className="fixed bottom-24 left-1/2 -translate-x-1/2 px-5 py-3 rounded-xl text-sm font-medium shadow-lg animate-fade-in-up z-50"
          style={{ backgroundColor: 'var(--brand-green)', color: '#ffffff' }}
        >
          反馈入口即将上线
        </div>
      )}
    </div>
  );
}

/* ================================================================== */
/*  Sub-components                                                     */
/* ================================================================== */

function ResultStepBar() {
  const steps = [
    { label: '上传照片', state: 'done' as const },
    { label: '确认信息', state: 'done' as const },
    { label: '查看结果', state: 'active' as const },
  ];
  return (
    <div className="flex items-center justify-center gap-0 mb-6">
      {steps.map((step, i) => (
        <div key={step.label} className="flex items-center">
          <div className="flex flex-col items-center">
            <div
              className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold"
              style={{
                backgroundColor:
                  step.state === 'done' || step.state === 'active'
                    ? 'var(--primary-green)'
                    : '#d4ddd7',
                color: '#fff',
              }}
            >
              {step.state === 'done' ? (
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              ) : (
                i + 1
              )}
            </div>
            <span
              className="text-xs mt-1.5 whitespace-nowrap"
              style={{
                color:
                  step.state === 'active'
                    ? 'var(--text-primary)'
                    : 'var(--text-secondary)',
                fontWeight: step.state === 'active' ? 600 : 400,
              }}
            >
              {step.label}
            </span>
          </div>
          {i < steps.length - 1 && (
            <div
              className="w-12 sm:w-16 h-0.5 mx-2 mb-5"
              style={{ backgroundColor: 'var(--primary-green)' }}
            />
          )}
        </div>
      ))}
    </div>
  );
}

/** 通用卡片容器：沿用确认页卡片样式 */
function Card({ children }: { children: ReactNode }) {
  return (
    <div
      className="rounded-2xl p-5 mb-4"
      style={{
        backgroundColor: 'var(--card-bg)',
        boxShadow: 'var(--card-shadow)',
        borderRadius: '16px',
      }}
    >
      {children}
    </div>
  );
}

/** 问号：点击查看说明。align='right' 用于靠近右边缘的位置，避免弹层溢出 */
function InfoDot({
  open,
  onToggle,
  tip = RANGE_TIP,
  align = 'center',
  label = '查看说明',
  className = '',
}: {
  open: boolean;
  onToggle: () => void;
  tip?: ReactNode;
  align?: 'center' | 'right';
  label?: string;
  className?: string;
}) {
  return (
    <span className={`relative inline-flex items-center align-middle ml-1 ${className}`}>
      <button
        type="button"
        onClick={onToggle}
        aria-label={label}
        className="w-4 h-4 rounded-full inline-flex items-center justify-center text-[10px] font-bold leading-none transition-opacity hover:opacity-70"
        style={{
          border: '1px solid var(--text-secondary)',
          color: 'var(--text-secondary)',
          backgroundColor: 'transparent',
        }}
      >
        ?
      </button>
      {open && (
        <span
          className={`absolute top-6 z-30 w-60 text-xs leading-relaxed rounded-lg p-3 shadow-lg ${
            align === 'right' ? 'right-0' : 'left-1/2 -translate-x-1/2'
          }`}
          style={{
            backgroundColor: 'var(--card-bg)',
            color: 'var(--text-primary)',
            border: '1px solid #eef2ef',
          }}
        >
          {tip}
        </span>
      )}
    </span>
  );
}

/** 弱化区间行：约 min–max kcal */
function RangeLine({
  min,
  max,
  open,
  onToggle,
}: {
  min: number;
  max: number;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>
      约 {fmtKcal(min)}–{fmtKcal(max)} kcal
      <InfoDot open={open} onToggle={onToggle} />
    </p>
  );
}

/** 1. 今日汇总：实际摄入为主，目标与达成次之 */
function DailySummaryCard({
  data,
  infoOpen,
  onToggleInfo,
}: {
  data: Workflow2ResultData;
  infoOpen: boolean;
  onToggleInfo: () => void;
}) {
  const s = data.daily_summary;
  return (
    <Card>
      <p className="text-sm mb-1" style={{ color: 'var(--text-secondary)' }}>
        今日实际摄入
      </p>
      <p
        className="text-3xl font-semibold"
        style={{ color: 'var(--brand-green)' }}
      >
        {fmtKcal(s.daily_kcal_mid)}{' '}
        <span
          className="text-base font-normal"
          style={{ color: 'var(--text-secondary)' }}
        >
          kcal
        </span>
      </p>
      <RangeLine
        min={s.daily_kcal_min}
        max={s.daily_kcal_max}
        open={infoOpen}
        onToggle={onToggleInfo}
      />

      <div
        className="mt-4 pt-4 grid grid-cols-2 gap-4"
        style={{ borderTop: '1px solid #eef2ef' }}
      >
        <div>
          <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
            目标热量
          </p>
          <p
            className="text-lg font-semibold mt-0.5"
            style={{ color: 'var(--text-primary)' }}
          >
            {fmtKcal(s.daily_target_kcal)}{' '}
            <span
              className="text-xs font-normal"
              style={{ color: 'var(--text-secondary)' }}
            >
              kcal
            </span>
          </p>
        </div>
        <div>
          <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
            目标达成
          </p>
          <p
            className="text-lg font-semibold mt-0.5"
            style={{ color: 'var(--text-primary)' }}
          >
            {fmtKcal(s.progress_pct)}%
          </p>
        </div>
      </div>

      {/* 进度条：宽度直接用 progress_ratio，不重算 */}
      <div
        className="mt-3 w-full h-2 rounded-full overflow-hidden"
        style={{ backgroundColor: '#eef2ef' }}
      >
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{
            width: progressWidth(s.progress_ratio),
            backgroundColor: 'var(--primary-green)',
          }}
        />
      </div>
    </Card>
  );
}

/** 2. 本餐结果 */
function MealSummaryCard({
  data,
  infoOpen,
  onToggleInfo,
}: {
  data: Workflow2ResultData;
  infoOpen: boolean;
  onToggleInfo: () => void;
}) {
  const m = data.meal_summary;
  return (
    <Card>
      <p className="text-sm mb-1" style={{ color: 'var(--text-secondary)' }}>
        本餐摄入
      </p>
      <p
        className="text-2xl font-semibold"
        style={{ color: 'var(--brand-green)' }}
      >
        {fmtKcal(m.meal_kcal_mid)}{' '}
        <span
          className="text-base font-normal"
          style={{ color: 'var(--text-secondary)' }}
        >
          kcal
        </span>
      </p>
      <RangeLine
        min={m.meal_kcal_min}
        max={m.meal_kcal_max}
        open={infoOpen}
        onToggle={onToggleInfo}
      />
    </Card>
  );
}

/** 3. 菜品卡：摘要行右侧展示 kcal / 热量区间 / 计算依据问号，点击展开详情与食材 */
function DishResultCard({
  dish,
  expanded,
  onToggle,
  rangeInfoOpen,
  onToggleRangeInfo,
  basisOpen,
  onToggleBasis,
}: {
  dish: ResultDish;
  expanded: boolean;
  onToggle: () => void;
  rangeInfoOpen: boolean;
  onToggleRangeInfo: () => void;
  basisOpen: boolean;
  onToggleBasis: () => void;
}) {
  const hasFailedIngredient = dish.ingredients.some(
    (ing) => typeof ing.failure_reason === 'string' && ing.failure_reason.trim() !== ''
  );

  return (
    <div
      className="rounded-2xl"
      style={{
        backgroundColor: 'var(--card-bg)',
        boxShadow: 'var(--card-shadow)',
        borderRadius: '16px',
      }}
    >
      {/* 摘要行：始终可见。左右分开成独立按钮，避免问号按钮嵌套在按钮里 */}
      <div className="w-full flex items-start gap-3 px-4 py-4">
        <button
          type="button"
          onClick={onToggle}
          className="flex-1 min-w-0 text-left pt-0.5 transition-opacity hover:opacity-80"
        >
          <div className="flex items-center gap-2 flex-wrap">
            <span
              className="text-base font-semibold"
              style={{ color: 'var(--text-primary)' }}
            >
              {dish.dish_label}
            </span>
            {hasFailedIngredient && (
              <span
                className="text-[11px] px-2 py-0.5 rounded-full"
                style={{ backgroundColor: '#fdf0ef', color: '#b42318' }}
              >
                部分食材异常
              </span>
            )}
          </div>
        </button>

        <div className="flex-shrink-0 text-right relative">
          {/* kcal 右上方：计算依据问号 */}
          <div className="flex items-start justify-end gap-1">
            <p
              className="text-lg font-semibold leading-none pt-0.5"
              style={{ color: 'var(--brand-green)' }}
            >
              {fmtKcal(dish.kcal_mid)} kcal
            </p>
            <InfoDot
              open={basisOpen}
              onToggle={onToggleBasis}
              tip={BASIS_CONTENT}
              align="right"
              label="查看计算依据"
              className="-mt-1.5"
            />
          </div>

          {/* 热量区间：紧跟在右侧 kcal 下方 */}
          <p
            className="text-[11px] mt-2 whitespace-nowrap"
            style={{ color: 'var(--text-secondary)' }}
          >
            热量区间 {fmtKcal(dish.kcal_min)}–{fmtKcal(dish.kcal_max)} kcal
            <InfoDot
              open={rangeInfoOpen}
              onToggle={onToggleRangeInfo}
              align="right"
              label="查看热量区间说明"
            />
          </p>

          <button
            type="button"
            onClick={onToggle}
            className="text-[11px] mt-1.5 ml-auto flex items-center gap-1 transition-opacity hover:opacity-70"
            style={{ color: 'var(--text-secondary)' }}
          >
            {expanded ? '收起' : '查看计算详情'}
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="transition-transform"
              style={{ transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)' }}
            >
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>
        </div>
      </div>

      {/* 展开区：计算详情 + 食材（不再重复「总热量」与「做法摘要行」） */}
      {expanded && (
        <div
          className="px-4 pb-4 flex flex-col gap-3"
          style={{ borderTop: '1px solid #eef2ef' }}
        >
          <div className="pt-3 grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <DetailCell label="做法" value={dish.method_display_name} />
            </div>
            <DetailCell
              label="油热量"
              value={`${fmtKcal(dish.oil_kcal_min)}–${fmtKcal(dish.oil_kcal_max)} kcal`}
            />
            <DetailCell
              label="油量"
              value={`${fmtKcal(dish.oil_min_g)}–${fmtKcal(dish.oil_max_g)} g`}
            />
          </div>

          <div className="h-px w-full" style={{ backgroundColor: '#eef2ef' }} />
          <p
            className="text-xs font-medium uppercase tracking-wide"
            style={{ color: 'var(--text-secondary)' }}
          >
            食材
          </p>
          <div className="flex flex-col gap-2">
            {dish.ingredients.map((ing, idx) => (
              <IngredientRow key={`${dish.dish_id}-ing-${idx}`} ingredient={ing} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function DetailCell({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
        {label}
      </p>
      <p className="text-sm font-medium mt-0.5" style={{ color: 'var(--text-primary)' }}>
        {value}
      </p>
    </div>
  );
}

/** 食材行：失败项高亮并展示 failure_reason 原文 */
function IngredientRow({ ingredient }: { ingredient: ResultIngredient }) {
  const failed =
    typeof ingredient.failure_reason === 'string' &&
    ingredient.failure_reason.trim() !== '';
  return (
    <div
      className="rounded-lg p-2.5 flex items-center gap-2 flex-wrap"
      style={{
        backgroundColor: failed ? '#fdf0ef' : '#fafcfb',
        border: failed ? '1px solid #f5c6c2' : '1px solid transparent',
      }}
    >
      <span
        className="text-sm flex-1 min-w-0"
        style={{ color: failed ? '#b42318' : 'var(--text-primary)' }}
      >
        {ingredient.ingredient_name}
        {failed && (
          <span className="ml-2 text-[11px] px-1.5 py-0.5 rounded" style={{ backgroundColor: '#f5c6c2' }}>
            计算失败
          </span>
        )}
      </span>
      <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>
        {fmtKcal(ingredient.estimated_weight_g)}g
      </span>
      <span
        className="text-sm font-medium"
        style={{ color: failed ? '#b42318' : 'var(--text-primary)' }}
      >
        {failed ? '—' : `${fmtKcal(ingredient.ingredient_kcal)} kcal`}
      </span>
      {failed && (
        <p className="w-full text-xs mt-1" style={{ color: '#b42318' }}>
          失败原因：{ingredient.failure_reason}
        </p>
      )}
    </div>
  );
}

/** 失败菜品明细：仅在 failed_dishes 存在时展示 */
function FailedDishesSection({ data }: { data: Workflow2ResultData }) {
  const failed = data.failed_dishes ?? [];
  if (failed.length === 0) return null;
  return (
    <Card>
      <p className="text-sm font-medium mb-2" style={{ color: '#b42318' }}>
        部分菜品计算未完成
      </p>
      <div className="flex flex-col gap-2">
        {failed.map((d) => (
          <div
            key={d.dish_id}
            className="rounded-lg p-3"
            style={{ backgroundColor: '#fdf0ef', border: '1px solid #f5c6c2' }}
          >
            <p className="text-sm font-medium" style={{ color: '#b42318' }}>
              {d.dish_label}
            </p>
            <p className="text-xs mt-1" style={{ color: '#b42318' }}>
              失败原因：{d.dish_failure_reason}
            </p>
          </div>
        ))}
      </div>
    </Card>
  );
}

/** 全部失败：不显示正常热量卡片，给出失败信息 + 反馈入口 + 返回确认页 */
function AllFailedState({
  data,
  onBack,
}: {
  data: Workflow2ResultData;
  onBack: () => void;
}) {
  const reasons: string[] = [];
  (data.failed_dishes ?? []).forEach((d) => {
    if (d.dish_failure_reason) reasons.push(`${d.dish_label}：${d.dish_failure_reason}`);
  });
  data.result_dishes.forEach((dish) =>
    dish.ingredients.forEach((ing) => {
      if (ing.failure_reason && ing.failure_reason.trim()) {
        reasons.push(`${dish.dish_label} · ${ing.ingredient_name}：${ing.failure_reason}`);
      }
    })
  );

  return (
    <Card>
      <p className="text-base font-semibold mb-2" style={{ color: '#b42318' }}>
        本餐计算未完成
      </p>
      <p className="text-sm leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
        当前餐没有可用的热量结果，请返回确认页检查信息后重试。
      </p>
      {reasons.length > 0 && (
        <div className="mt-3 flex flex-col gap-2">
          {reasons.map((r, i) => (
            <p
              key={i}
              className="text-xs rounded-lg p-2.5"
              style={{ backgroundColor: '#fdf0ef', color: '#b42318' }}
            >
              {r}
            </p>
          ))}
        </div>
      )}
      <button
        type="button"
        onClick={onBack}
        className="mt-4 w-full py-3 rounded-xl text-sm font-medium transition-all duration-200 hover:opacity-90"
        style={{
          backgroundColor: 'var(--primary-green)',
          color: '#ffffff',
          borderRadius: '12px',
          boxShadow: '0 4px 12px rgba(111, 155, 123, 0.3)',
        }}
      >
        返回确认页
      </button>
    </Card>
  );
}

/** 无载荷：引导回到上传页 */
function EmptyState({ onAddMeal }: { onAddMeal: () => void }) {
  return (
    <Card>
      <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
        暂无计算结果。请先上传餐食照片并完成识别。
      </p>
      <button
        type="button"
        onClick={onAddMeal}
        className="mt-4 w-full py-3 rounded-xl text-sm font-medium"
        style={{
          backgroundColor: 'var(--primary-green)',
          color: '#ffffff',
          borderRadius: '12px',
        }}
      >
        上传照片
      </button>
    </Card>
  );
}

/** 底部导航：样式与确认页 BottomBar 完全一致 */
function ResultBottomBar({
  onAddMeal,
  onFinish,
}: {
  onAddMeal: () => void;
  onFinish: () => void;
}) {
  return (
    <div
      className="fixed bottom-0 left-0 right-0 z-40 border-t"
      style={{
        backgroundColor: 'var(--card-bg)',
        borderColor: '#eef2ef',
        boxShadow: '0 -2px 12px rgba(49, 92, 69, 0.06)',
      }}
    >
      <div className="max-w-lg mx-auto px-4 py-3 flex gap-3">
        <button
          onClick={onAddMeal}
          className="flex-1 py-3 rounded-xl text-sm font-medium border transition-all duration-200 hover:bg-gray-50"
          style={{
            borderColor: '#d4ddd7',
            color: 'var(--text-primary)',
            borderRadius: '12px',
          }}
        >
          新增餐食
        </button>
        <button
          onClick={onFinish}
          className="flex-1 py-3 rounded-xl text-sm font-medium transition-all duration-200 hover:opacity-90"
          style={{
            backgroundColor: 'var(--primary-green)',
            color: '#ffffff',
            borderRadius: '12px',
            boxShadow: '0 4px 12px rgba(111, 155, 123, 0.3)',
          }}
        >
          完成记录
        </button>
      </div>
    </div>
  );
}
