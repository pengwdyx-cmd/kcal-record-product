/* ================================================================== */
/*  Coze 工作流 1 结束节点输出｜确认页数据契约                          */
/*                                                                    */
/*  本文件只描述「工作流 1 已经输出的字段」，不新增、不重命名、不删减。 */
/*  可编辑字段的修改一律通过下方纯函数完成：                            */
/*    - 只覆盖允许修改的字段                                           */
/*    - 其余字段（含全部 nutrition 字段）通过对象展开原样保留          */
/*    - 保持 confirmation_dishes → dish → ingredients 的层级结构      */
/* ================================================================== */

/** 工作流 1 结束节点输出中，确认页需要使用的两个字段 */
export interface Workflow1ConfirmOutput {
  /** 用户上传的餐食图片（工作流 1 结束节点输出） */
  meal_image: string;
  /** 确认页菜品数据（工作流 1 结束节点输出） */
  confirmation_dishes: ConfirmationDish[];
}

/**
 * 确认页最终输出｜供工作流 2 计算餐食能量使用。
 *
 * 来源区分（重要）：
 *   - meal_image / confirmation_dishes 来自工作流 1；
 *   - daily_target_kcal 来自上传页用户输入，不是工作流 1 识别字段，
 *     也不是写死常量；由上传页跨页传递到确认页。
 *
 * confirmation_dishes 内部结构完全不变（本类型只在外层加一个字段）。
 */
export interface ConfirmFinalOutput {
  meal_image: string;
  /** 每日目标热量，来自上传页用户输入 */
  daily_target_kcal: number;
  confirmation_dishes: ConfirmationDish[];
}

/** sessionStorage 跨页传递的键（上传页写，确认页读） */
export const CONFIRM_INPUT_STORAGE_KEY = 'calorie_confirm_input_v1';

/** 上传页写入、确认页读取的跨页载荷 */
export interface ConfirmPageInput {
  meal_image: string;
  daily_target_kcal: number;
  /**
   * 工作流 1 真实识别结果（可选，向后兼容旧载荷）。
   * 接入后由上传页在识别成功时写入；确认页据此覆盖 Demo fallback。
   * 内部字段结构完全沿用 ConfirmationDish，原样保留不转换。
   */
  confirmation_dishes?: ConfirmationDish[];
  /**
   * 工作流 1 本次执行的调试元信息（可选，向后兼容旧载荷）。
   * 由上传页在识别成功时写入，确认页只用于展示调试链接与耗时，
   * 不参与 confirmation_dishes 数据契约，也不传给工作流 2。
   */
  workflow1_debug_url?: string;
  workflow1_execute_id?: string;
  workflow1_upload_ms?: number;
  workflow1_workflow_ms?: number;
}

/* ================================================================== */
/*  工作流 1 本地 API Route 响应（uploadFile + workflow/run）             */
/* ================================================================== */

/**
 * 工作流 1 Route 成功响应：只返回前端需要的 confirmation_dishes，
 * 外加本次执行的调试元信息（不含 Token、图片数据、菜品内容）。
 */
export interface Workflow1RouteSuccess {
  success: true;
  confirmation_dishes: ConfirmationDish[];
  /** Coze 试运行调试页链接（流式 Done 事件返回，7 天有效） */
  debug_url?: string;
  /** 本次执行 ID */
  execute_id?: string;
  /** 图片上传耗时（ms），仅用于确认页展示 */
  upload_ms?: number;
  /** 工作流流式执行耗时（ms），仅用于确认页展示 */
  workflow_ms?: number;
}

/** 工作流 1 Route 失败响应 */
export interface Workflow1RouteError {
  success: false;
  error: string;
  /** 失败阶段，便于前端给出针对性提示 */
  stage?: 'upload' | 'workflow' | 'parse' | 'config' | 'request';
  missing?: string[];
}

export type Workflow1RouteResponse =
  | Workflow1RouteSuccess
  | Workflow1RouteError;

/** 类型守卫：判断工作流 1 响应是否成功且含合法菜品数组 */
export function isWorkflow1Success(
  value: Workflow1RouteResponse
): value is Workflow1RouteSuccess {
  return (
    value.success === true &&
    Array.isArray(value.confirmation_dishes) &&
    value.confirmation_dishes.length > 0
  );
}

export interface ConfirmationDish {
  dish_id: string;
  dish_label: string;
  cooking_method_code: string;
  method_display_name: string;
  method_needs_confirm: boolean;
  oil_rule_found: boolean;
  oil_min_g_per_100g: number;
  oil_max_g_per_100g: number;
  ingredients: ConfirmationIngredient[];
}

export interface ConfirmationIngredient {
  dish_id: string;
  ingredient_name: string;
  /** 识别出的熟制重量 */
  estimated_weight_g: number;
  food_state_code: string;
  name_needs_confirm: boolean;
  weight_needs_confirm: boolean;

  /* ---- 工作流内部营养匹配／计算信息：确认页只读，必须保留 ---- */
  /** exact / ambiguous / unresolved */
  nutrition_status: string;
  reference_id: string;
  reference_name: string;
  energy_kj_per_100g: number;
  /** raw / direct */
  reference_state_code: string;
  /** raw_pending / direct / blocked */
  calculation_path: string;
  block_reason: string;
  energy_includes_oil: boolean;
}

/* ================================================================== */
/*  做法映射：cooking_method_code ↔ method_display_name                */
/*  来源：用户提供的 Coze 油量规则表截图（8 档），不得自行改写文案      */
/* ================================================================== */

export interface CookingMethodOption {
  /** 对应 cooking_method_code */
  code: string;
  /** 对应 method_display_name */
  label: string;
}

export const COOKING_METHOD_OPTIONS: readonly CookingMethodOption[] = [
  { code: 'DEEP_FRY', label: '深炸／酥炸／复炸' },
  { code: 'SHALLOW_FRY_OR_BATTER_FRY', label: '浅炸／裹粉煎炸' },
  { code: 'HIGH_OIL_STIR_FRY_SEAR', label: '爆炒／干煸／普通煎' },
  { code: 'STANDARD_STIR_FRY_BRAISE_BAKE', label: '普通炒／焖／红烧／烘烤' },
  { code: 'LIGHT_STIR_FRY_SEAR_BAKE', label: '清炒／少油煎烤' },
  { code: 'LOW_OIL_STEW', label: '炖煮／烩／少油焖' },
  { code: 'COLD_MIX_CLEAR_COOK', label: '凉拌／清炖／清汤' },
  { code: 'RAW_STEAM_BOIL', label: '生食／蒸／水煮' },
];

/**
 * 生成下拉选项。若工作流返回的 code 不在规则表内，额外补一个「当前做法」项，
 * 目的是让 select 能正确显示真实返回值，而不是丢掉它或改写成别的 code。
 * 该补充项只影响可选项，不写回数据。
 */
export function buildCookingMethodOptions(
  dish: ConfirmationDish
): CookingMethodOption[] {
  const options: CookingMethodOption[] = [...COOKING_METHOD_OPTIONS];
  const exists = options.some((o) => o.code === dish.cooking_method_code);
  if (!exists) {
    options.unshift({
      code: dish.cooking_method_code,
      label: dish.method_display_name,
    });
  }
  return options;
}

/* ================================================================== */
/*  纯更新函数：确认页唯一允许改动 confirmation_dishes 的入口          */
/* ================================================================== */

/** 按 dish_id 定位并替换一个菜品；数组长度与顺序不变（不新增／不删除菜品） */
export function updateDishInList(
  dishes: readonly ConfirmationDish[],
  dishId: string,
  updater: (dish: ConfirmationDish) => ConfirmationDish
): ConfirmationDish[] {
  return dishes.map((dish) =>
    dish.dish_id === dishId ? updater(dish) : dish
  );
}

/** 按 index 定位并替换一个食材；数组长度与顺序不变（不新增／不删除食材） */
function updateIngredientInDish(
  dish: ConfirmationDish,
  index: number,
  updater: (ingredient: ConfirmationIngredient) => ConfirmationIngredient
): ConfirmationDish {
  if (index < 0 || index >= dish.ingredients.length) return dish;
  const ingredients = dish.ingredients.map((ingredient, i) =>
    i === index ? updater(ingredient) : ingredient
  );
  return { ...dish, ingredients };
}

/* ---- 允许修改的 6 个字段 ---- */

/** dish_label：菜名，写回 dish_label */
export function withDishLabel(
  dish: ConfirmationDish,
  value: string
): ConfirmationDish {
  return { ...dish, dish_label: value };
}

/**
 * 做法：用户看到 method_display_name，保存 cooking_method_code。
 * 两者必须成对写回，避免只改展示文字导致 code 与文案不对应。
 */
export function withCookingMethod(
  dish: ConfirmationDish,
  code: string,
  options: readonly CookingMethodOption[] = COOKING_METHOD_OPTIONS
): ConfirmationDish {
  const found = options.find((option) => option.code === code);
  if (!found) return dish;
  return {
    ...dish,
    cooking_method_code: found.code,
    method_display_name: found.label,
  };
}

/** 油量区间下限：写回 oil_min_g_per_100g（数值来自数据，不在 UI 写死） */
export function withOilMin(
  dish: ConfirmationDish,
  value: number
): ConfirmationDish {
  return { ...dish, oil_min_g_per_100g: value };
}

/** 油量区间上限：写回 oil_max_g_per_100g */
export function withOilMax(
  dish: ConfirmationDish,
  value: number
): ConfirmationDish {
  return { ...dish, oil_max_g_per_100g: value };
}

/** ingredient_name：修改已有食材名称，写回 ingredient_name */
export function withIngredientName(
  dish: ConfirmationDish,
  index: number,
  value: string
): ConfirmationDish {
  return updateIngredientInDish(dish, index, (ingredient) => ({
    ...ingredient,
    ingredient_name: value,
  }));
}

/** estimated_weight_g：修改已有食材熟制重量，写回 estimated_weight_g */
export function withIngredientWeight(
  dish: ConfirmationDish,
  index: number,
  value: number
): ConfirmationDish {
  return updateIngredientInDish(dish, index, (ingredient) => ({
    ...ingredient,
    estimated_weight_g: value,
  }));
}

/* ================================================================== */
/*  工作流 2 调用结果（Demo：展示原始返回，不开发结果页）                  */
/* ================================================================== */

/** Coze workflow/run 原始响应中本页会用到的字段 */
export interface Workflow2Response {
  /** 0 表示 Coze API 调用成功；非零表示业务/接口错误 */
  code: number;
  /** 错误信息，code 非零时可查看 */
  msg?: string;
  /** 工作流执行结果，通常为 JSON 序列化字符串 */
  data?: string;
  /** 试运行调试页链接 */
  debug_url?: string;
  execute_id?: string;
  usage?: {
    input_count?: number;
    token_count?: number;
    output_count?: number;
  };
  detail?: { logid?: string };
}

/** 本地 API Route 自身错误（网络/配置/超时）时返回的形状 */
export interface Workflow2RouteError {
  error: string;
  missing?: string[];
  upstreamStatus?: number;
}

/** 类型守卫：区分「Coze 原始响应」与「本地 Route 错误」 */
export function isWorkflow2RouteError(
  value: Workflow2Response | Workflow2RouteError
): value is Workflow2RouteError {
  return typeof (value as Workflow2RouteError).error === 'string';
}
