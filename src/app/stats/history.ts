/* ================================================================== */
/*  统计页数据层｜本地餐食历史                                         */
/*                                                                    */
/*  原则：只消费「工作流 2 真实返回」与「用户上传的真实图片」，           */
/*  不虚构任何餐食、热量或时间。历史记录仅存于本机 localStorage，        */
/*  不新增 API、不改工作流 2 Route、不改确认页数据契约。                 */
/* ================================================================== */

import {
  RESULT_STORAGE_KEY,
  parseResultData,
  getResultStatus,
  type ResultPageInput,
} from '../result/result-data';

/** 本机历史记录键（结果页写，统计页读） */
export const MEAL_HISTORY_KEY = 'calorie_meal_history_v1';

/* ------------------------------------------------------------------ */
/*  猫头贴纸：来自 public/cats/ 的真实猫照片，共 26 张                 */
/*  每新增一条餐食记录，随机换一只（且不与上一条重复）                 */
/* ------------------------------------------------------------------ */

export const CAT_COUNT = 26;

/** 猫图地址：id 为 1..CAT_COUNT，越界或缺失时回落到第一只 */
export function catSrc(id: number | null | undefined): string {
  const n = typeof id === 'number' && Number.isInteger(id) && id >= 1 && id <= CAT_COUNT
    ? id
    : 1;
  return `/cats/cat-${String(n).padStart(2, '0')}.png`;
}

/** 随机挑一只猫；CAT_COUNT > 1 时排除上一条用过的，保证「每加一餐必换」 */
export function pickCatId(previous?: number | null): number {
  if (typeof previous === 'number' && previous >= 1 && previous <= CAT_COUNT && CAT_COUNT > 1) {
    const offset = 1 + Math.floor(Math.random() * (CAT_COUNT - 1));
    return ((previous - 1 + offset) % CAT_COUNT) + 1;
  }
  return 1 + Math.floor(Math.random() * CAT_COUNT);
}

/** 无记录时的猫：按当天日期确定性选取，刷新不跳动 */
export function defaultCatId(now: Date): number {
  const seed = now.getFullYear() * 10000 + (now.getMonth() + 1) * 100 + now.getDate();
  return (seed % CAT_COUNT) + 1;
}

/** 单条餐食记录：字段全部来自工作流 2 结果与用户上传图片 */
export interface MealRecord {
  /** 唯一 ID，用于去重与 React key */
  id: string;
  /** 记录生成时间（ISO），用于排序与时间线展示 */
  created_at: string;
  /** 本地日期 YYYY-MM-DD，用于「今天」判定与周历打点 */
  date: string;
  /** 本餐热量中位值，来自 meal_summary.meal_kcal_mid */
  kcal: number;
  /** 本餐热量区间，来自 meal_summary */
  kcal_min: number;
  kcal_max: number;
  /** 菜品名列表，用于时间线里的「食物名称」 */
  dish_labels: string[];
  /** 餐食图片缩略图（dataURL / URL），为空时统计页显示占位块 */
  image: string;
  /** 每日目标热量，来自 daily_summary.daily_target_kcal；无有效值则为 null */
  daily_target_kcal: number | null;
  /** 本餐对应的猫图编号（1..CAT_COUNT）；旧版本记录可能没有此字段 */
  cat_id?: number | null;
}

/* ------------------------------------------------------------------ */
/*  日期工具（全部基于浏览器本地时间）                                  */
/* ------------------------------------------------------------------ */

export function localDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

const WEEK_CN = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];

export function formatDateLabel(d: Date): string {
  return `${d.getMonth() + 1}月${d.getDate()}日 · ${WEEK_CN[d.getDay()]}`;
}

export function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** 本周一到周日（周一为首日），与参考图的周历一致 */
export function weekDays(now: Date): Date[] {
  const diff = (now.getDay() + 6) % 7;
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - diff);
  return Array.from({ length: 7 }, (_, i) =>
    new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + i)
  );
}

/* ------------------------------------------------------------------ */
/*  读取历史                                                          */
/* ------------------------------------------------------------------ */

/** 读取并按时间由近到远排序；解析失败或数据损坏时安全降级为空数组 */
export function loadHistory(): MealRecord[] {
  try {
    const raw = localStorage.getItem(MEAL_HISTORY_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const records = parsed.filter(
      (item): item is MealRecord =>
        typeof item === 'object' &&
        item !== null &&
        typeof (item as MealRecord).id === 'string' &&
        typeof (item as MealRecord).created_at === 'string' &&
        typeof (item as MealRecord).kcal === 'number'
    );
    return records.sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
  } catch {
    return [];
  }
}

export function todayRecords(history: MealRecord[], now: Date): MealRecord[] {
  const key = localDateKey(now);
  return history.filter((r) => r.date === key);
}

/* ------------------------------------------------------------------ */
/*  写入：把「当前结果页载荷」落为一条历史记录                          */
/* ------------------------------------------------------------------ */

/** 把大图压成小缩略图，避免 localStorage 配额被图片撑爆 */
function makeThumbnail(dataUrl: string, maxEdge = 220): Promise<string> {
  if (!dataUrl || typeof window === 'undefined') return Promise.resolve('');
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      try {
        const scale = Math.min(1, maxEdge / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(dataUrl);
          return;
        }
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', 0.6));
      } catch {
        // 跨域图片无法读像素时，原样保留（只是不再缩小）
        resolve(dataUrl);
      }
    };
    img.onerror = () => resolve('');
    img.src = dataUrl;
  });
}

/**
 * 从结果页的 sessionStorage 载荷生成一条记录并写入 localStorage。
 * 返回 false 表示没有可用结果（例如全部计算失败）或存储不可用，
 * 此时调用方仍可正常跳转，只是不会新增历史记录。
 */
export async function saveCurrentMeal(now: Date = new Date()): Promise<boolean> {
  try {
    const rawStr = sessionStorage.getItem(RESULT_STORAGE_KEY);
    if (!rawStr) return false;
    const input = JSON.parse(rawStr) as ResultPageInput;
    const data = parseResultData(input?.raw?.data);
    if (!data) return false;
    // 全部失败不产生记录，避免统计页出现 0 kcal 的假餐食
    if (getResultStatus(data) === 'all_failed') return false;

    const meal = data.meal_summary;
    const mid =
      typeof meal?.meal_kcal_mid === 'number' && Number.isFinite(meal.meal_kcal_mid)
        ? meal.meal_kcal_mid
        : 0;
    // 中位值缺失时，用已成功计算的菜品热量之和（仍是真实字段，不臆造）
    const kcal =
      mid > 0
        ? mid
        : data.result_dishes.reduce(
            (sum, dish) =>
              sum +
              (typeof dish.kcal_mid === 'number' && Number.isFinite(dish.kcal_mid)
                ? dish.kcal_mid
                : 0),
            0
          );
    if (!(kcal > 0)) return false;

    const target = data.daily_summary?.daily_target_kcal;
    // 每新增一餐就从猫图合集里随机换一只，且不与上一餐重复
    const previousCatId = loadHistory()[0]?.cat_id ?? null;
    const record: MealRecord = {
      id: `${data.meal_id || 'meal'}_${now.getTime()}`,
      created_at: now.toISOString(),
      date: localDateKey(now),
      kcal,
      kcal_min:
        typeof meal?.meal_kcal_min === 'number' ? meal.meal_kcal_min : kcal,
      kcal_max:
        typeof meal?.meal_kcal_max === 'number' ? meal.meal_kcal_max : kcal,
      dish_labels: data.result_dishes
        .map((d) => d.dish_label)
        .filter((label): label is string => typeof label === 'string' && label.trim() !== ''),
      image: await makeThumbnail(input?.meal_image ?? ''),
      daily_target_kcal:
        typeof target === 'number' && Number.isFinite(target) && target > 0
          ? target
          : null,
      cat_id: pickCatId(previousCatId),
    };

    let history = loadHistory();
    if (history.some((r) => r.id === record.id)) return true;
    history = [record, ...history].slice(0, 60);

    // 配额兜底：优先保住最新记录，逐步丢弃最旧记录的图片，再逐步裁剪条数
    for (let attempt = 0; attempt < 6; attempt += 1) {
      try {
        localStorage.setItem(MEAL_HISTORY_KEY, JSON.stringify(history));
        return true;
      } catch {
        let idx = -1;
        for (let i = history.length - 1; i >= 1; i -= 1) {
          if (history[i].image) {
            idx = i;
            break;
          }
        }
        if (idx >= 0) {
          history = history.map((r, i) => (i === idx ? { ...r, image: '' } : r));
        } else if (history.length > 1) {
          history = history.slice(0, Math.max(1, Math.floor(history.length / 2)));
        } else {
          return false;
        }
      }
    }
    return false;
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ */
/*  猫头趣味文案：根据「今天已记录餐数」变化                            */
/* ------------------------------------------------------------------ */

export function catMessage(count: number): string {
  if (count <= 0) {
    return '今天还一口没记呢。本猫合理怀疑你在偷偷修炼辟谷大法，点右下角的加号，先去吃点什么吧。';
  }
  if (count === 1) {
    return '才一顿？本猫的饭碗都比你满。再吃点吧，别让胃空着加班。';
  }
  if (count === 2) {
    return '两顿了，离三餐 KPI 就差一顿。本猫在旁边替你盯着，加油。';
  }
  if (count === 3) {
    return '刚好三餐，自律得让本猫有点感动。今天就不偷吃你的零食了。';
  }
  if (count === 4) {
    return '第四顿了啊？本猫开始怀疑你是在替我试吃。要不，先把筷子放下？';
  }
  return `第 ${count} 顿了。本猫建议把冰箱门暂时焊上，我们一起冷静一下，少吃点。`;
}
