'use client';

import { useState, useCallback, useEffect, useRef, type ReactNode } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  RESULT_STORAGE_KEY,
  parseResultData,
  getResultStatus,
  type ResultPageInput,
} from '../result/result-data';
import {
  CONFIRM_INPUT_STORAGE_KEY,
  buildCookingMethodOptions,
  updateDishInList,
  withCookingMethod,
  withDishLabel,
  withIngredientName,
  withIngredientWeight,
  withOilMax,
  withOilMin,
  type ConfirmPageInput,
  type ConfirmationDish,
  type ConfirmationIngredient,
  type Workflow2Response,
  type Workflow2RouteError,
  isWorkflow2RouteError,
} from './confirm-data';

/* ================================================================== */
/*  Props：数据由 confirm/page.tsx（数据接入点）注入                    */
/* ================================================================== */

interface ConfirmPageProps {
  /** 工作流 1 结束节点输出字段 meal_image */
  mealImage: string;
  /** 工作流 1 结束节点输出字段 confirmation_dishes */
  initialConfirmationDishes: ConfirmationDish[];
  /** 上传页用户输入的目标热量（来自 sessionStorage，非工作流 1 字段） */
  initialDailyTargetKcal: number;
}

/* ================================================================== */
/*  「需要确认」的 UI 标记                                             */
/*                                                                    */
/*  是否高亮完全由工作流 1 的真实布尔字段决定：                        */
/*    method_needs_confirm / name_needs_confirm / weight_needs_confirm  */
/*  下面的 Set 只记录「用户本次是否点过确认」这一 UI 状态，              */
/*  不写入、不替代、不重命名 confirmation_dishes 里的任何业务字段。     */
/* ================================================================== */

function methodKey(dishId: string): string {
  return `${dishId}::method`;
}

function oilKey(dishId: string): string {
  return `${dishId}::oil`;
}

function nameKey(dishId: string, index: number): string {
  return `${dishId}::ing::${index}::name`;
}

function weightKey(dishId: string, index: number): string {
  return `${dishId}::ing::${index}::weight`;
}

/** 空输入不写入，避免把 number 字段变成 NaN／0 或破坏结构 */
function parseNumberInput(raw: string): number | null {
  if (raw.trim() === '') return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

/**
 * 工作流 1 用 -1（或任意负数）作为「未匹配到油量规则」的哨兵值，
 * 并置 oil_rule_found=false。它不是真实油量，不能当作数值展示给用户。
 */
function isOilMissingValue(value: number): boolean {
  return !Number.isFinite(value) || value < 0;
}

/** 该菜品的油量是否需要人工确认（未匹配规则，或区间存在哨兵值） */
function isOilMissingDish(dish: ConfirmationDish): boolean {
  return (
    !dish.oil_rule_found ||
    isOilMissingValue(dish.oil_min_g_per_100g) ||
    isOilMissingValue(dish.oil_max_g_per_100g)
  );
}

/**
 * 待确认数量口径 = 页面上带「确认」按钮的 UI 项数量，逐项一一对应：
 *   1) 做法       —— 1 项
 *   2) 建议油量   —— 1 项（未匹配到油量规则时）
 *   3) 每个食材行 —— 1 项（一行只有一个确认按钮，同时确认名称与重量）
 * 旧实现按「字段」数（name_needs_confirm + weight_needs_confirm 分开算），
 * 与页面上一行一个按钮的视觉数量不一致，导致卡片徽标对不齐。
 */
function getPendingCount(
  dish: ConfirmationDish,
  confirmedKeys: ReadonlySet<string>
): number {
  let count = 0;
  if (
    dish.method_needs_confirm &&
    !confirmedKeys.has(methodKey(dish.dish_id))
  ) {
    count++;
  }
  if (
    isOilMissingDish(dish) &&
    !confirmedKeys.has(oilKey(dish.dish_id))
  ) {
    count++;
  }
  dish.ingredients.forEach((ingredient, index) => {
    const namePending =
      ingredient.name_needs_confirm &&
      !confirmedKeys.has(nameKey(dish.dish_id, index));
    const weightPending =
      ingredient.weight_needs_confirm &&
      !confirmedKeys.has(weightKey(dish.dish_id, index));
    if (namePending || weightPending) count++;
  });
  return count;
}

/* ================================================================== */
/*  Component                                                          */
/* ================================================================== */

export default function ConfirmPage({
  mealImage,
  initialConfirmationDishes,
  initialDailyTargetKcal,
}: ConfirmPageProps) {
  const router = useRouter();
  /**
   * 跨页真实数据：首屏用 props（SSR 安全），客户端挂载后读 sessionStorage 覆盖。
   * 不在渲染期直接访问 sessionStorage，避免 hydration 不一致。
   */
  const [currentMealImage, setCurrentMealImage] =
    useState<string>(mealImage);
  const [currentDailyTargetKcal, setCurrentDailyTargetKcal] =
    useState<number>(initialDailyTargetKcal);
  /** 始终保持工作流 1 的原始结构：对象展开只覆盖允许修改的字段 */
  const [dishes, setDishes] = useState<ConfirmationDish[]>(
    initialConfirmationDishes
  );

  useEffect(() => {
    const urlTarget = new URLSearchParams(window.location.search).get(
      'daily_target_kcal'
    );
    // 目标热量优先取 URL query（小数据、一定能传），sessionStorage 作为兜底
    try {
      if (urlTarget !== null) {
        const parsed = Number(urlTarget);
        if (Number.isFinite(parsed) && parsed > 0) {
          setCurrentDailyTargetKcal(Math.round(parsed));
        }
      }
    } catch {
      // URL 不可读时保留 props 值
    }

    try {
      const raw = sessionStorage.getItem(CONFIRM_INPUT_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as ConfirmPageInput;
      if (typeof parsed.meal_image === 'string' && parsed.meal_image) {
        setCurrentMealImage(parsed.meal_image);
      }
      // URL 未带目标热量时，才用 sessionStorage 里的值兜底
      if (
        urlTarget === null &&
        typeof parsed.daily_target_kcal === 'number' &&
        Number.isFinite(parsed.daily_target_kcal) &&
        parsed.daily_target_kcal > 0
      ) {
        setCurrentDailyTargetKcal(parsed.daily_target_kcal);
      }
      // 工作流 1 真实识别结果：存在合法数组时覆盖 Demo fallback。
      // 原样使用，不转换/不重命名/不删减内部任何字段。
      if (
        Array.isArray(parsed.confirmation_dishes) &&
        parsed.confirmation_dishes.length > 0 &&
        parsed.confirmation_dishes.every(
          (d) => typeof d === 'object' && d !== null
        )
      ) {
        setDishes(parsed.confirmation_dishes);
      }
    } catch {
      // 无有效跨页载荷时保留 props 值（本地 fallback）
    }
  }, []);

  /** 仅 UI：用户点过「确认」的项目 */
  const [confirmedKeys, setConfirmedKeys] = useState<Set<string>>(
    () => new Set<string>()
  );
  const [showReidentifyDialog, setShowReidentifyDialog] = useState(false);
  const [showToast, setShowToast] = useState(false);
  const [toastMessage, setToastMessage] = useState('');
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [showDataPreview, setShowDataPreview] = useState(false);
  /** 工作流 2 调用状态 */
  const [isSubmitting, setIsSubmitting] = useState(false);
  /** 工作流 2 原始返回（成功时展示） */
  const [workflow2Result, setWorkflow2Result] =
    useState<Workflow2Response | null>(null);
  /** 工作流 2 调用错误（本地 Route 错误或业务错误文案） */
  const [workflow2Error, setWorkflow2Error] = useState('');
  /** 全部失败时的失败原因（停在确认页展示，不跳结果页） */
  const [allFailedReasons, setAllFailedReasons] = useState<string[]>([]);
  /** 结果卡片容器：计算完成后自动滚动到可见区域 */
  const resultCardRef = useRef<HTMLDivElement | null>(null);

  /** 计算结果就绪后，延迟等卡片渲染完成再平滑滚动过去 */
  const revealResult = useCallback(() => {
    setShowDataPreview(true);
    setTimeout(() => {
      resultCardRef.current?.scrollIntoView({
        behavior: 'smooth',
        block: 'start',
      });
    }, 80);
  }, []);

  /* ---- state updaters（唯一改动 dishes 的入口） ---- */

  const updateDish = useCallback(
    (dishId: string, updater: (dish: ConfirmationDish) => ConfirmationDish) => {
      setDishes((prev) => updateDishInList(prev, dishId, updater));
    },
    []
  );

  const handleDishLabelChange = useCallback(
    (dishId: string, value: string) => {
      updateDish(dishId, (dish) => withDishLabel(dish, value));
    },
    [updateDish]
  );

  /** 只传 code；display_name 由映射表成对写回，保证两者对应 */
  const handleCookingMethodChange = useCallback(
    (dishId: string, code: string) => {
      updateDish(dishId, (dish) =>
        withCookingMethod(dish, code, buildCookingMethodOptions(dish))
      );
    },
    [updateDish]
  );

  const handleOilMinChange = useCallback(
    (dishId: string, value: number | null) => {
      if (value === null) return;
      updateDish(dishId, (dish) => withOilMin(dish, value));
    },
    [updateDish]
  );

  const handleOilMaxChange = useCallback(
    (dishId: string, value: number | null) => {
      if (value === null) return;
      updateDish(dishId, (dish) => withOilMax(dish, value));
    },
    [updateDish]
  );

  const handleIngredientNameChange = useCallback(
    (dishId: string, index: number, value: string) => {
      updateDish(dishId, (dish) =>
        withIngredientName(dish, index, value)
      );
    },
    [updateDish]
  );

  const handleIngredientWeightChange = useCallback(
    (dishId: string, index: number, value: number | null) => {
      if (value === null) return;
      updateDish(dishId, (dish) =>
        withIngredientWeight(dish, index, value)
      );
    },
    [updateDish]
  );

  /** 只改 UI 标记，不碰 confirmation_dishes 里任何 needs_confirm 字段 */
  const markConfirmed = useCallback((keys: string[]) => {
    setConfirmedKeys((prev) => {
      const next = new Set(prev);
      keys.forEach((key) => next.add(key));
      return next;
    });
  }, []);

  /* ---- actions ---- */

  const handleReidentify = useCallback(() => {
    setShowReidentifyDialog(false);
    setToastMessage('重新识别功能即将上线，敬请期待');
    setShowToast(true);
    setTimeout(() => setShowToast(false), 3000);
  }, []);

  /**
   * 提交给本地 API Route → 服务端调用 Coze 工作流 2（同步非流式）。
   * 只传工作流 2 开始节点的两个入参：daily_target_kcal、confirmation_dishes。
   * 不传 meal_image。confirmation_dishes 内部结构原样透传。
   */
  const handleConfirmAndCalculate = useCallback(async () => {
    if (isSubmitting) return;
    setIsSubmitting(true);
    setWorkflow2Result(null);
    setWorkflow2Error('');
    setAllFailedReasons([]);
    setShowDataPreview(false);

    try {
      const response = await fetch('/api/coze/workflow2', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          daily_target_kcal: currentDailyTargetKcal,
          confirmation_dishes: dishes,
        }),
      });

      const payload = (await response.json()) as
        | Workflow2Response
        | Workflow2RouteError;

      // 本地 Route 层错误（配置缺失/网络/超时/参数校验失败）
      if (!response.ok || isWorkflow2RouteError(payload)) {
        const err = payload as Workflow2RouteError;
        const message = err.error || `请求失败（HTTP ${response.status}）`;
        setWorkflow2Error(message);
        setToastMessage(message);
        setShowToast(true);
        revealResult();
        setTimeout(() => setShowToast(false), 5000);
        return;
      }

      // Coze 原始响应
      const result = payload as Workflow2Response;
      setWorkflow2Result(result);

      if (result.code === 0) {
        // 解析工作流 2 的业务数据，按三态分发：
        const resultData = parseResultData(result.data);
        if (resultData && getResultStatus(resultData) === 'all_failed') {
          // 状态3：全部失败 → 停在确认页，展示失败原因，不跳结果页
          const reasons: string[] = [];
          (resultData.failed_dishes ?? []).forEach((d) => {
            if (d.dish_failure_reason) {
              reasons.push(`${d.dish_label}：${d.dish_failure_reason}`);
            }
          });
          resultData.result_dishes.forEach((dish) =>
            dish.ingredients.forEach((ing) => {
              if (ing.failure_reason && ing.failure_reason.trim()) {
                reasons.push(
                  `${dish.dish_label} · ${ing.ingredient_name}：${ing.failure_reason}`
                );
              }
            })
          );
          setAllFailedReasons(reasons);
          setToastMessage('本餐计算未完成，请检查信息后重试');
          setShowToast(true);
          revealResult();
          setTimeout(() => setShowToast(false), 5000);
          return;
        }

        if (!resultData) {
          // code=0 但 data 无法解析：不留空结果页，停在确认页提示
          setWorkflow2Error('计算结果格式异常，请稍后重试');
          setToastMessage('计算结果格式异常，请稍后重试');
          setShowToast(true);
          revealResult();
          setTimeout(() => setShowToast(false), 5000);
          return;
        }

        // 状态1/2：写入结果载荷并跳转结果页（结果页负责所有展示）
        const resultPayload: ResultPageInput = {
          raw: {
            code: result.code,
            ...(result.msg ? { msg: result.msg } : {}),
            ...(result.data ? { data: result.data } : {}),
            ...(result.debug_url ? { debug_url: result.debug_url } : {}),
            ...(result.execute_id ? { execute_id: result.execute_id } : {}),
          },
          meal_image: currentMealImage,
        };
        try {
          sessionStorage.setItem(
            RESULT_STORAGE_KEY,
            JSON.stringify(resultPayload)
          );
          router.push('/result');
          return;
        } catch {
          // 存储失败：留在确认页并提示，不跳到空结果页
          setWorkflow2Error('结果传递失败，请重试');
          setToastMessage('结果传递失败，请重试');
          setShowToast(true);
          revealResult();
          setTimeout(() => setShowToast(false), 5000);
          return;
        }
      }

      // API 请求成功，但工作流业务返回错误码。
      // 不臆测具体原因，统一展示"计算未成功 + code + 原始 msg"，把判断权留给用户。
      const message = result.msg
        ? `计算未成功：code=${result.code} · ${result.msg}`
        : `计算未成功：code=${result.code}`;
      setWorkflow2Error(message);
      setToastMessage(message);
      setShowToast(true);
      revealResult();
      setTimeout(() => setShowToast(false), 5000);
    } catch (err) {
      const message =
        err instanceof Error ? `提交失败：${err.message}` : '提交失败：未知错误';
      setWorkflow2Error(message);
      setToastMessage(message);
      setShowToast(true);
      revealResult();
      setTimeout(() => setShowToast(false), 5000);
    } finally {
      setIsSubmitting(false);
    }
  }, [
    dishes,
    currentDailyTargetKcal,
    currentMealImage,
    isSubmitting,
    revealResult,
    router,
  ]);

  /* ---- render ---- */

  return (
    <div
      className="min-h-screen flex flex-col"
      style={{ backgroundColor: 'var(--page-bg)' }}
    >
      {/* Scrollable Content */}
      <div className="flex-1 pb-24">
        <div className="max-w-lg mx-auto px-4 pt-6 sm:pt-8">
          {/* Brand Header */}
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

          {/* Step Progress Bar */}
          <StepProgressBar />

          {/* Daily Goal Card：来自上传页用户输入，不是写死值 */}
          <DailyGoalCard dailyTargetKcal={currentDailyTargetKcal} />

          {/* Image Section：来自 meal_image */}
          <ImageSection
            mealImage={currentMealImage}
            onImageClick={() => setLightboxOpen(true)}
          />

          {/* Dish Cards：来自 confirmation_dishes */}
          <div className="flex flex-col gap-4 mt-4">
            {dishes.map((dish) => (
              <DishCard
                key={dish.dish_id}
                dish={dish}
                confirmedKeys={confirmedKeys}
                onDishLabelChange={handleDishLabelChange}
                onCookingMethodChange={handleCookingMethodChange}
                onOilMinChange={handleOilMinChange}
                onOilMaxChange={handleOilMaxChange}
                onIngredientNameChange={handleIngredientNameChange}
                onIngredientWeightChange={handleIngredientWeightChange}
                onConfirm={markConfirmed}
              />
            ))}
          </div>

          {/* 全部失败：停在确认页，展示失败原因与反馈入口（业务字段原文） */}
          {allFailedReasons.length > 0 && (
            <div
              className="rounded-2xl p-4 mb-4"
              style={{
                backgroundColor: 'var(--card-bg)',
                boxShadow: 'var(--card-shadow)',
                borderRadius: '16px',
              }}
            >
              <p
                className="text-sm font-medium mb-2"
                style={{ color: '#b42318' }}
              >
                本餐计算未完成
              </p>
              <p
                className="text-xs mb-2 leading-relaxed"
                style={{ color: 'var(--text-secondary)' }}
              >
                请核对信息后重试；如信息无误，可通过反馈入口提交问题。
              </p>
              <div className="flex flex-col gap-2">
                {allFailedReasons.map((reason, i) => (
                  <p
                    key={i}
                    className="text-xs rounded-lg p-2.5 leading-relaxed"
                    style={{ backgroundColor: '#fdf0ef', color: '#b42318' }}
                  >
                    {reason}
                  </p>
                ))}
              </div>
              <button
                type="button"
                onClick={() => {
                  setToastMessage('反馈入口即将上线');
                  setShowToast(true);
                  setTimeout(() => setShowToast(false), 3000);
                }}
                className="text-xs mt-3 underline"
                style={{ color: 'var(--primary-green)' }}
              >
                问题反馈
              </button>
            </div>
          )}

          {/* 提交结果预览：展示提交入参 + 工作流 2 原始返回（或错误） */}
          {showDataPreview && (
            <div ref={resultCardRef}>
              <DataPreviewCard
                dailyTargetKcal={currentDailyTargetKcal}
                dishes={dishes}
                workflow2Result={workflow2Result}
                workflow2Error={workflow2Error}
                onClose={() => setShowDataPreview(false)}
              />
            </div>
          )}
        </div>
      </div>

      {/* Fixed Bottom Bar */}
      <BottomBar
        onReidentify={() => setShowReidentifyDialog(true)}
        onConfirm={handleConfirmAndCalculate}
        isSubmitting={isSubmitting}
      />

      {/* Reidentify Dialog */}
      {showReidentifyDialog && (
        <ConfirmDialog
          title="重新识别"
          message="重新识别可能覆盖当前修改，确定继续吗？"
          onCancel={() => setShowReidentifyDialog(false)}
          onConfirm={handleReidentify}
        />
      )}

      {/* Lightbox：展示用户上传的原始餐图 */}
      {lightboxOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          onClick={() => setLightboxOpen(false)}
        >
          <div
            className="relative max-w-md w-full aspect-square rounded-2xl overflow-hidden"
            style={{ backgroundColor: 'var(--card-bg)' }}
            onClick={(e) => e.stopPropagation()}
          >
            {currentMealImage ? (
              <img
                src={currentMealImage}
                alt="用户上传的餐食图片"
                className="w-full h-full object-contain"
              />
            ) : (
              <div
                className="w-full h-full flex items-center justify-center text-sm"
                style={{ color: 'var(--text-secondary)' }}
              >
                暂无餐食图片
              </div>
            )}
          </div>
          <button
            className="absolute top-4 right-4 w-10 h-10 rounded-full flex items-center justify-center bg-white/20 hover:bg-white/30 transition-colors"
            onClick={() => setLightboxOpen(false)}
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="white"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      )}

      {/* Toast */}
      {showToast && (
        <div
          className="fixed bottom-24 left-1/2 -translate-x-1/2 px-5 py-3 rounded-xl text-sm font-medium shadow-lg animate-fade-in-up z-50"
          style={{
            backgroundColor: 'var(--brand-green)',
            color: '#ffffff',
          }}
        >
          {toastMessage}
        </div>
      )}
    </div>
  );
}

/* ================================================================== */
/*  Sub-Components                                                     */
/* ================================================================== */

/* ---- Step Progress Bar ---- */

function StepProgressBar() {
  const steps = [
    { label: '上传照片', done: true },
    { label: '确认信息', done: false, active: true },
    { label: '查看结果', done: false, active: false },
  ];

  return (
    <div className="flex items-center justify-center gap-0 mb-6">
      {steps.map((step, i) => (
        <div key={step.label} className="flex items-center">
          {/* Circle + Label */}
          <div className="flex flex-col items-center">
            <div
              className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold transition-colors"
              style={{
                backgroundColor: step.done
                  ? 'var(--primary-green)'
                  : step.active
                    ? 'var(--primary-green)'
                    : '#d4ddd7',
                color: step.done || step.active ? '#fff' : 'var(--text-secondary)',
              }}
            >
              {step.done ? (
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
                color: step.active
                  ? 'var(--text-primary)'
                  : 'var(--text-secondary)',
                fontWeight: step.active ? 600 : 400,
              }}
            >
              {step.label}
            </span>
          </div>

          {/* Connector Line */}
          {i < steps.length - 1 && (
            <div
              className="w-12 sm:w-16 h-0.5 mx-2 mb-5"
              style={{
                backgroundColor: step.done
                  ? 'var(--primary-green)'
                  : '#d4ddd7',
              }}
            />
          )}
        </div>
      ))}
    </div>
  );
}

/* ---- Daily Goal Card ---- */

function DailyGoalCard({ dailyTargetKcal }: { dailyTargetKcal: number }) {
  return (
    <div
      className="rounded-2xl p-5 mb-4"
      style={{
        backgroundColor: 'var(--card-bg)',
        boxShadow: 'var(--card-shadow)',
        borderRadius: '16px',
      }}
    >
      <p
        className="text-sm mb-1"
        style={{ color: 'var(--text-secondary)' }}
      >
        每日目标热量
      </p>
      <p
        className="text-2xl font-semibold"
        style={{ color: 'var(--brand-green)' }}
      >
        {dailyTargetKcal}{' '}
        <span
          className="text-base font-normal"
          style={{ color: 'var(--text-secondary)' }}
        >
          kcal
        </span>
      </p>
    </div>
  );
}

/* ---- Image Section ---- */

interface ImageSectionProps {
  /** 工作流 1 的 meal_image；为空时显示空态文字，不使用写死图片 */
  mealImage: string;
  onImageClick: () => void;
}

function ImageSection({ mealImage, onImageClick }: ImageSectionProps) {
  const hasImage = mealImage.trim().length > 0;

  return (
    <div
      className="rounded-2xl p-4 mb-4 flex items-start gap-3"
      style={{
        backgroundColor: 'var(--card-bg)',
        boxShadow: 'var(--card-shadow)',
        borderRadius: '16px',
      }}
    >
      {/* Thumbnail */}
      <button
        onClick={onImageClick}
        className="flex-shrink-0 w-16 h-16 rounded-xl overflow-hidden cursor-pointer hover:opacity-90 transition-opacity"
        style={{ backgroundColor: 'var(--warm-accent)' }}
      >
        {hasImage ? (
          <img
            src={mealImage}
            alt="用户上传的餐食图片"
            className="w-full h-full object-cover"
          />
        ) : (
          <div
            className="w-full h-full flex items-center justify-center text-[10px] leading-tight text-center"
            style={{ color: 'var(--text-secondary)' }}
          >
            暂无图片
          </div>
        )}
      </button>

      {/* Tips */}
      <div className="flex-1 min-w-0">
        <p
          className="text-sm font-medium mb-1"
          style={{ color: 'var(--pending-text)' }}
        >
          请重点确认黄色标记项
        </p>
        <p
          className="text-xs leading-relaxed"
          style={{ color: 'var(--text-secondary)' }}
        >
          AI 识别及热量结果均为估算值，请核对食材和重量。
        </p>
      </div>
    </div>
  );
}

/* ---- Dish Card ---- */

interface DishCardProps {
  dish: ConfirmationDish;
  confirmedKeys: ReadonlySet<string>;
  onDishLabelChange: (dishId: string, value: string) => void;
  onCookingMethodChange: (dishId: string, code: string) => void;
  onOilMinChange: (dishId: string, value: number | null) => void;
  onOilMaxChange: (dishId: string, value: number | null) => void;
  onIngredientNameChange: (
    dishId: string,
    index: number,
    value: string
  ) => void;
  onIngredientWeightChange: (
    dishId: string,
    index: number,
    value: number | null
  ) => void;
  onConfirm: (keys: string[]) => void;
}

function DishCard({
  dish,
  confirmedKeys,
  onDishLabelChange,
  onCookingMethodChange,
  onOilMinChange,
  onOilMaxChange,
  onIngredientNameChange,
  onIngredientWeightChange,
  onConfirm,
}: DishCardProps) {
  const isPending = (key: string, needsConfirm: boolean): boolean =>
    needsConfirm && !confirmedKeys.has(key);

  const methodPending = isPending(
    methodKey(dish.dish_id),
    dish.method_needs_confirm
  );
  // 油量未匹配到规则时（-1 哨兵），作为一个明确的待确认项：黄色高亮 + 确认按钮
  const oilPending = isPending(
    oilKey(dish.dish_id),
    isOilMissingDish(dish)
  );
  const options = buildCookingMethodOptions(dish);
  const pendingCount = getPendingCount(dish, confirmedKeys);

  return (
    <div
      className="rounded-2xl overflow-hidden"
      style={{
        backgroundColor: 'var(--card-bg)',
        boxShadow: 'var(--card-shadow)',
        borderRadius: '16px',
      }}
    >
      {/* Card Header：dish_label（可修改，写回 dish_label） */}
      <div className="flex items-center justify-between gap-3 px-4 pt-4 pb-2">
        <input
          type="text"
          value={dish.dish_label}
          onChange={(e) => onDishLabelChange(dish.dish_id, e.target.value)}
          aria-label="菜品名称"
          className="flex-1 min-w-0 text-base font-semibold bg-transparent border-b outline-none py-0.5 transition-colors focus:border-[var(--primary-green)]"
          style={{
            color: 'var(--text-primary)',
            borderColor: '#e2e8e4',
          }}
        />
        {pendingCount > 0 && (
          <span
            className="flex-shrink-0 text-xs px-2.5 py-1 rounded-full font-medium"
            style={{
              backgroundColor: 'var(--pending-bg)',
              color: 'var(--pending-text)',
            }}
          >
            {pendingCount} 项待确认
          </span>
        )}
      </div>

      {/* Card Body */}
      <div className="px-4 pb-4 flex flex-col gap-3">
        {/* Cooking Method：select 的 value = cooking_method_code，展示 = method_display_name */}
        <FieldRow
          label="做法"
          pending={methodPending}
          onConfirm={() => onConfirm([methodKey(dish.dish_id)])}
        >
          <select
            value={dish.cooking_method_code}
            onChange={(e) =>
              onCookingMethodChange(dish.dish_id, e.target.value)
            }
            className="w-full text-sm py-2 px-3 rounded-lg border outline-none transition-colors focus:ring-2 focus:ring-[var(--primary-green)]/30"
            style={{
              borderColor: methodPending
                ? 'var(--pending-border)'
                : '#e2e8e4',
              backgroundColor: methodPending
                ? 'var(--pending-bg)'
                : '#fafcfb',
              color: 'var(--text-primary)',
            }}
          >
            {options.map((option) => (
              <option key={option.code} value={option.code}>
                {option.label}
              </option>
            ))}
          </select>
        </FieldRow>

        {/* Oil Range：两个输入框严格对应工作流 1 的两个字段原值：
            第一个 = oil_min_g_per_100g，第二个 = oil_max_g_per_100g，
            不做任何隐藏或替换。工作流用 -1 标记「未匹配到油量规则」时，
            仍原样显示 -1，同时用黄色高亮 + 文案提醒用户人工修改。 */}
        <FieldRow
          label="建议油量"
          pending={oilPending}
          onConfirm={() => onConfirm([oilKey(dish.dish_id)])}
        >
          <div className="flex items-center gap-2 flex-wrap">
            <input
              type="text"
              inputMode="decimal"
              value={String(dish.oil_min_g_per_100g)}
              onChange={(e) =>
                onOilMinChange(
                  dish.dish_id,
                  parseNumberInput(e.target.value)
                )
              }
              aria-label="油量下限 g/100g"
              className="w-16 text-sm py-1.5 px-2.5 rounded-lg border outline-none text-right transition-colors focus:ring-2 focus:ring-[var(--primary-green)]/30"
              style={{
                borderColor: oilPending
                  ? 'var(--pending-border)'
                  : '#e2e8e4',
                backgroundColor: oilPending
                  ? 'var(--pending-bg)'
                  : '#fff',
                color: 'var(--text-primary)',
              }}
            />
            <span
              className="text-sm"
              style={{ color: 'var(--text-secondary)' }}
            >
              –
            </span>
            <input
              type="text"
              inputMode="decimal"
              value={String(dish.oil_max_g_per_100g)}
              onChange={(e) =>
                onOilMaxChange(
                  dish.dish_id,
                  parseNumberInput(e.target.value)
                )
              }
              aria-label="油量上限 g/100g"
              className="w-16 text-sm py-1.5 px-2.5 rounded-lg border outline-none text-right transition-colors focus:ring-2 focus:ring-[var(--primary-green)]/30"
              style={{
                borderColor: oilPending
                  ? 'var(--pending-border)'
                  : '#e2e8e4',
                backgroundColor: oilPending
                  ? 'var(--pending-bg)'
                  : '#fff',
                color: 'var(--text-primary)',
              }}
            />
            <span
              className="text-xs"
              style={{ color: 'var(--text-secondary)' }}
            >
              g/100g
            </span>
          </div>
          <p
            className="text-xs mt-1"
            style={{ color: 'var(--text-secondary)' }}
          >
            {isOilMissingDish(dish)
              ? '未匹配到油量规则，请人工填写参考范围'
              : 'AI 根据烹饪方式估算的参考范围，可修改'}
          </p>
        </FieldRow>

        {/* Divider */}
        <div
          className="h-px w-full"
          style={{ backgroundColor: '#eef2ef' }}
        />

        {/* Ingredients */}
        <div className="flex flex-col gap-2">
          <p
            className="text-xs font-medium uppercase tracking-wide"
            style={{ color: 'var(--text-secondary)' }}
          >
            食材
          </p>
          {dish.ingredients.map((ingredient, index) => {
            const pendingName = isPending(
              nameKey(dish.dish_id, index),
              ingredient.name_needs_confirm
            );
            const pendingWeight = isPending(
              weightKey(dish.dish_id, index),
              ingredient.weight_needs_confirm
            );
            return (
              <IngredientRow
                key={`${dish.dish_id}-ing-${index}`}
                ingredient={ingredient}
                dishId={dish.dish_id}
                index={index}
                pendingName={pendingName}
                pendingWeight={pendingWeight}
                onNameChange={onIngredientNameChange}
                onWeightChange={onIngredientWeightChange}
                onConfirm={onConfirm}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ---- Field Row ---- */

interface FieldRowProps {
  label: string;
  pending: boolean;
  /** 为 false 时只显示标题，不显示「确认／已确认」状态区 */
  showStatus?: boolean;
  onConfirm?: () => void;
  children: ReactNode;
}

function FieldRow({
  label,
  pending,
  showStatus = true,
  onConfirm,
  children,
}: FieldRowProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <span
          className="text-xs font-medium"
          style={{
            color: pending ? 'var(--pending-text)' : 'var(--text-secondary)',
          }}
        >
          {label}
        </span>
        {showStatus &&
          (pending ? (
            <button
              onClick={onConfirm}
              className="text-xs flex items-center gap-1 transition-colors hover:opacity-80"
              style={{ color: 'var(--primary-green)' }}
            >
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polyline points="20 6 9 17 4 12" />
              </svg>
              确认
            </button>
          ) : (
            <span
              className="text-xs flex items-center gap-1"
              style={{ color: 'var(--primary-green)' }}
            >
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polyline points="20 6 9 17 4 12" />
              </svg>
              已确认
            </span>
          ))}
      </div>
      {children}
    </div>
  );
}

/* ---- Ingredient Row ---- */

interface IngredientRowProps {
  ingredient: ConfirmationIngredient;
  dishId: string;
  index: number;
  pendingName: boolean;
  pendingWeight: boolean;
  onNameChange: (
    dishId: string,
    index: number,
    value: string
  ) => void;
  onWeightChange: (
    dishId: string,
    index: number,
    value: number | null
  ) => void;
  onConfirm: (keys: string[]) => void;
}

function IngredientRow({
  ingredient,
  dishId,
  index,
  pendingName,
  pendingWeight,
  onNameChange,
  onWeightChange,
  onConfirm,
}: IngredientRowProps) {
  const stillPending = pendingName || pendingWeight;

  return (
    <div
      className="flex items-center gap-2 rounded-lg p-2 transition-colors"
      style={{
        backgroundColor: stillPending
          ? 'var(--pending-bg)'
          : 'transparent',
      }}
    >
      {/* Name Input → ingredient_name */}
      <input
        type="text"
        value={ingredient.ingredient_name}
        onChange={(e) => onNameChange(dishId, index, e.target.value)}
        aria-label="食材名称"
        className="flex-1 min-w-0 text-sm py-1.5 px-2.5 rounded-lg border outline-none transition-colors focus:ring-2 focus:ring-[var(--primary-green)]/30"
        style={{
          borderColor: pendingName
            ? 'var(--pending-border)'
            : '#e2e8e4',
          backgroundColor: '#fff',
          color: 'var(--text-primary)',
        }}
      />

      {/* Weight Input → estimated_weight_g */}
      <div className="flex items-center gap-1 flex-shrink-0">
        <input
          type="text"
          inputMode="decimal"
          value={String(ingredient.estimated_weight_g)}
          onChange={(e) =>
            onWeightChange(dishId, index, parseNumberInput(e.target.value))
          }
          aria-label="食材熟制重量 g"
          className="w-16 text-sm py-1.5 px-2.5 rounded-lg border outline-none text-right transition-colors focus:ring-2 focus:ring-[var(--primary-green)]/30"
          style={{
            borderColor: pendingWeight
              ? 'var(--pending-border)'
              : '#e2e8e4',
            backgroundColor: '#fff',
            color: 'var(--text-primary)',
          }}
        />
        <span
          className="text-xs flex-shrink-0"
          style={{ color: 'var(--text-secondary)' }}
        >
          g
        </span>
      </div>

      {/* Confirm Button（只改 UI 标记，不写入数据契约） */}
      {stillPending ? (
        <button
          onClick={() =>
            onConfirm([
              nameKey(dishId, index),
              weightKey(dishId, index),
            ])
          }
          className="flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center transition-colors hover:opacity-80"
          style={{
            backgroundColor: 'var(--primary-green)',
            color: '#fff',
          }}
          title="确认此项"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </button>
      ) : (
        <div
          className="flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center"
          style={{
            backgroundColor: 'rgba(111, 155, 123, 0.15)',
            color: 'var(--primary-green)',
          }}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </div>
      )}
    </div>
  );
}

/* ---- Data Preview（仅 Demo 验收用） ---- */

interface DataPreviewCardProps {
  dailyTargetKcal: number;
  dishes: ConfirmationDish[];
  workflow2Result: Workflow2Response | null;
  workflow2Error: string;
  onClose: () => void;
}

function DataPreviewCard({
  dailyTargetKcal,
  dishes,
  workflow2Result,
  workflow2Error,
  onClose,
}: DataPreviewCardProps) {
  /** 提交给工作流 2 的入参：只含两个字段，不含 meal_image */
  const submittedInput = {
    daily_target_kcal: dailyTargetKcal,
    confirmation_dishes: dishes,
  };

  return (
    <div
      className="mt-4 rounded-2xl p-4"
      style={{
        backgroundColor: 'var(--card-bg)',
        boxShadow: 'var(--card-shadow)',
        borderRadius: '16px',
      }}
    >
      <div className="flex items-center justify-between gap-2 mb-1">
        <p
          className="text-sm font-medium"
          style={{ color: 'var(--text-primary)' }}
        >
          工作流 2 提交结果
        </p>
        <button
          onClick={onClose}
          className="text-xs flex-shrink-0 transition-colors hover:underline"
          style={{ color: 'var(--primary-green)' }}
        >
          关闭
        </button>
      </div>

      {/* 错误提示 */}
      {workflow2Error && (
        <div
          className="text-xs mb-2 leading-relaxed rounded-lg p-3"
          style={{ backgroundColor: '#fdf0ef', color: '#b42318' }}
        >
          {workflow2Error}
        </div>
      )}

      {/* 成功状态标记 */}
      {workflow2Result && (
        <p
          className="text-xs mb-2 font-medium"
          style={{ color: workflow2Result.code === 0 ? '#2e7d4f' : '#b42318' }}
        >
          {workflow2Result.code === 0
            ? '✓ Coze API 调用成功（code=0）'
            : `✕ 工作流返回错误码 code=${workflow2Result.code}`}
        </p>
      )}

      {/* 提交入参：只含 daily_target_kcal + confirmation_dishes */}
      <p
        className="text-xs mb-1 font-medium"
        style={{ color: 'var(--text-secondary)' }}
      >
        提交入参（不含 meal_image）
      </p>
      <pre
        className="text-[11px] leading-relaxed overflow-auto max-h-48 rounded-lg p-3 mb-3"
        style={{ backgroundColor: '#fafcfb', color: 'var(--text-primary)' }}
      >
        {JSON.stringify(submittedInput, null, 2)}
      </pre>

      {/* 工作流 2 原始返回 */}
      {workflow2Result && (
        <>
          <p
            className="text-xs mb-1 font-medium"
            style={{ color: 'var(--text-secondary)' }}
          >
            工作流 2 原始返回
          </p>
          <pre
            className="text-[11px] leading-relaxed overflow-auto max-h-64 rounded-lg p-3"
            style={{ backgroundColor: '#fafcfb', color: 'var(--text-primary)' }}
          >
            {JSON.stringify(workflow2Result, null, 2)}
          </pre>
          {workflow2Result.debug_url && (
            <a
              href={workflow2Result.debug_url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs mt-2 inline-block hover:underline"
              style={{ color: 'var(--primary-green)' }}
            >
              查看工作流调试详情 ↗
            </a>
          )}
        </>
      )}
    </div>
  );
}

/* ---- Bottom Bar ---- */

interface BottomBarProps {
  onReidentify: () => void;
  onConfirm: () => void;
  isSubmitting: boolean;
}

function BottomBar({ onReidentify, onConfirm, isSubmitting }: BottomBarProps) {
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
          onClick={onReidentify}
          className="flex-1 py-3 rounded-xl text-sm font-medium border transition-all duration-200 hover:bg-gray-50"
          style={{
            borderColor: '#d4ddd7',
            color: 'var(--text-primary)',
            borderRadius: '12px',
          }}
        >
          重新识别
        </button>
        <button
          onClick={onConfirm}
          disabled={isSubmitting}
          className="flex-1 py-3 rounded-xl text-sm font-medium transition-all duration-200 hover:opacity-90 disabled:opacity-60 disabled:cursor-not-allowed"
          style={{
            backgroundColor: 'var(--primary-green)',
            color: '#ffffff',
            borderRadius: '12px',
            boxShadow: '0 4px 12px rgba(111, 155, 123, 0.3)',
          }}
        >
          {isSubmitting ? '计算中…' : '确认并计算'}
        </button>
      </div>
    </div>
  );
}

/* ---- Confirm Dialog ---- */

interface ConfirmDialogProps {
  title: string;
  message: string;
  onCancel: () => void;
  onConfirm: () => void;
}

function ConfirmDialog({
  title,
  message,
  onCancel,
  onConfirm,
}: ConfirmDialogProps) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: 'rgba(37, 51, 43, 0.4)' }}
    >
      <div
        className="w-full max-w-sm rounded-2xl p-6"
        style={{
          backgroundColor: 'var(--card-bg)',
          boxShadow: '0 16px 48px rgba(49, 92, 69, 0.15)',
        }}
      >
        <h3
          className="text-base font-semibold mb-2"
          style={{ color: 'var(--text-primary)' }}
        >
          {title}
        </h3>
        <p
          className="text-sm mb-5 leading-relaxed"
          style={{ color: 'var(--text-secondary)' }}
        >
          {message}
        </p>
        <div className="flex gap-3">
          <button
            onClick={onCancel}
            className="flex-1 py-2.5 rounded-xl text-sm font-medium border transition-colors hover:bg-gray-50"
            style={{
              borderColor: '#d4ddd7',
              color: 'var(--text-primary)',
              borderRadius: '12px',
            }}
          >
            取消
          </button>
          <button
            onClick={onConfirm}
            className="flex-1 py-2.5 rounded-xl text-sm font-medium transition-colors hover:opacity-90"
            style={{
              backgroundColor: 'var(--primary-green)',
              color: '#ffffff',
              borderRadius: '12px',
            }}
          >
            确定
          </button>
        </div>
      </div>
    </div>
  );
}
