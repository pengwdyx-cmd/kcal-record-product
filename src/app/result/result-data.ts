/* ================================================================== */
/*  结果页数据契约｜严格对应工作流 2 的输出字段                          */
/*                                                                    */
/*  原则：只用工作流 2 实际返回的字段，不自行创建、不改名、不重算。      */
/*  progress_pct / progress_ratio 直接取用，不在前端重新计算百分比。    */
/*  本文件只描述数据与纯函数，不含任何 UI。                             */
/* ================================================================== */

/** sessionStorage 跨页传递的键（确认页写，结果页读） */
export const RESULT_STORAGE_KEY = 'calorie_result_v1';

/** 工作流 2 的 data 字段反序列化后的业务数据（全部为真实字段） */
export interface Workflow2ResultData {
  daily_summary: {
    daily_kcal_max: number;
    daily_kcal_mid: number;
    daily_kcal_min: number;
    daily_ready: boolean;
    daily_target_kcal: number;
    failed_meal_count: number;
    failed_meal_ids: string[];
    meal_count: number;
    /** 目标达成百分比，直接展示，不重算 */
    progress_pct: number;
    /** 进度条比例值，直接作为宽度比例 */
    progress_ratio: number;
  };
  meal_id: string;
  meal_summary: {
    calc_ready: boolean;
    dish_count: number;
    failed_dish_ids: string[];
    meal_kcal_max: number;
    meal_kcal_max_raw: number;
    meal_kcal_mid: number;
    meal_kcal_mid_raw: number;
    meal_kcal_min: number;
    meal_kcal_min_raw: number;
    total_kcal_ready: boolean;
  };
  result_dishes: ResultDish[];
  /**
   * 失败菜品明细（部分工作流版本返回）。
   * 示例数据未出现此字段，故为可选；存在时优先展示具体失败原因。
   */
  failed_dishes?: FailedDish[];
}

export interface ResultDish {
  dish_id: string;
  dish_label: string;
  method_display_name: string;
  kcal_min: number;
  kcal_mid: number;
  kcal_max: number;
  oil_kcal_min: number;
  oil_kcal_max: number;
  oil_min_g: number;
  oil_max_g: number;
  ingredients: ResultIngredient[];
}

export interface ResultIngredient {
  dish_id?: string;
  ingredient_name: string;
  estimated_weight_g: number;
  ingredient_kcal: number;
  /** 非空表示该食材计算失败 */
  failure_reason: string;
}

export interface FailedDish {
  dish_id: string;
  dish_label: string;
  dish_failure_reason: string;
}

/** 确认页写入、结果页读取的跨页载荷 */
export interface ResultPageInput {
  /** 工作流 2 的原始响应（含 data JSON 字符串、code/msg） */
  raw: {
    code: number;
    msg?: string;
    data?: string;
    debug_url?: string;
    execute_id?: string;
  };
  /** 餐食图片 dataURL（来自确认页，用于视觉延续；可为空） */
  meal_image: string;
}

/** 三态：全部成功 / 部分成功 / 全部失败 */
export type ResultStatus = 'all_success' | 'partial' | 'all_failed';

/**
 * 反序列化工作流 2 的 data 字段。
 * data 通常是 JSON 序列化字符串，个别场景可能已是对象。
 * 返回 null 表示无法解析出合法业务数据。
 */
export function parseResultData(rawData: string | undefined): Workflow2ResultData | null {
  if (!rawData) return null;
  let parsed: unknown;
  try {
    parsed = typeof rawData === 'string' ? JSON.parse(rawData) : rawData;
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const obj = parsed as Record<string, unknown>;
  if (
    typeof obj.daily_summary !== 'object' ||
    obj.daily_summary === null ||
    typeof obj.meal_summary !== 'object' ||
    obj.meal_summary === null ||
    !Array.isArray(obj.result_dishes)
  ) {
    return null;
  }
  return parsed as Workflow2ResultData;
}

/**
 * 判断当前餐是否存在任何一个可用热量结果。
 * 用于区分「部分成功」与「全部失败」。
 */
function hasUsableMealResult(data: Workflow2ResultData): boolean {
  const mid = data.meal_summary?.meal_kcal_mid;
  if (typeof mid === 'number' && Number.isFinite(mid) && mid > 0) return true;
  return data.result_dishes.some(
    (dish) =>
      typeof dish.kcal_mid === 'number' &&
      Number.isFinite(dish.kcal_mid) &&
      dish.kcal_mid > 0
  );
}

/**
 * 三态判定（严格按字段，不臆测原因）：
 *  - all_success：failed_meal_count===0 且 calc_ready===true，且无失败菜品/食材
 *  - all_failed ：当前餐无任何可用热量结果（calc_ready 为 false 或没有可用 kcal）
 *  - partial    ：有可用结果，但存在失败菜品或失败食材
 */
export function getResultStatus(data: Workflow2ResultData): ResultStatus {
  if (!hasUsableMealResult(data)) return 'all_failed';

  const failedByCount = data.daily_summary?.failed_meal_count ?? 0;
  const calcReady = data.meal_summary?.calc_ready === true;
  const totalReady = data.meal_summary?.total_kcal_ready === true;

  const hasFailedDish =
    (data.failed_dishes?.length ?? 0) > 0 ||
    (data.meal_summary?.failed_dish_ids?.length ?? 0) > 0;
  const hasFailedIngredient = data.result_dishes.some((dish) =>
    dish.ingredients.some(
      (ing) => typeof ing.failure_reason === 'string' && ing.failure_reason.trim() !== ''
    )
  );

  if (failedByCount === 0 && calcReady && totalReady && !hasFailedDish && !hasFailedIngredient) {
    return 'all_success';
  }
  return 'partial';
}

/** 数字安全格式化：非有限值显示为 — */
export function fmtKcal(value: unknown): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  return String(Math.round(value));
}

/** 进度条宽度：直接用 progress_ratio，限制在 0–100%，不重新计算 */
export function progressWidth(ratio: unknown): string {
  if (typeof ratio !== 'number' || !Number.isFinite(ratio)) return '0%';
  const pct = Math.min(1, Math.max(0, ratio)) * 100;
  return `${pct}%`;
}
