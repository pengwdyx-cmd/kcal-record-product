/* ================================================================== */
/*  统计页｜演示数据（仅用于效果核对）                                  */
/*                                                                    */
/*  仅在 URL 带 ?demo=1 时由 stats-page 读取，                          */
/*  不写入 localStorage、不参与任何真实数据流。                         */
/*  真实记录一律来自 saveCurrentMeal 写入的本机历史。                   */
/* ================================================================== */

import { localDateKey, type MealRecord } from './history';

export const DEMO_TARGET_KCAL = 1800;

export interface DemoMeal {
  /** 示例时刻（时 / 分） */
  hour: number;
  minute: number;
  meal_name: string;
  dish_labels: string[];
  kcal: number;
  kcal_min: number;
  kcal_max: number;
  image: string;
  /** 演示用固定猫编号，便于核对「每加一餐换一只」 */
  cat_id: number;
}

/** 按时间正序排列，取前 count 条组成今日记录 */
export const DEMO_MEALS: readonly DemoMeal[] = [
  {
    hour: 8,
    minute: 12,
    meal_name: '早餐',
    dish_labels: ['牛奶燕麦粥', '水煮蛋'],
    kcal: 386,
    kcal_min: 340,
    kcal_max: 430,
    image: '/meal-demo.svg',
    cat_id: 1,
  },
  {
    hour: 12,
    minute: 35,
    meal_name: '午餐',
    dish_labels: ['番茄炒蛋', '米饭', '清炒西兰花'],
    kcal: 642,
    kcal_min: 580,
    kcal_max: 710,
    image: '/meal-demo-2.svg',
    cat_id: 8,
  },
  {
    hour: 18,
    minute: 5,
    meal_name: '晚餐',
    dish_labels: ['香煎鸡胸', '蔬菜沙拉'],
    kcal: 458,
    kcal_min: 410,
    kcal_max: 505,
    image: '/meal-demo-3.svg',
    cat_id: 15,
  },
  {
    hour: 20,
    minute: 30,
    meal_name: '加餐',
    dish_labels: ['草莓酸奶'],
    kcal: 176,
    kcal_min: 150,
    kcal_max: 200,
    image: '/meal-demo-4.svg',
    cat_id: 22,
  },
];

export const DEMO_MAX_MEALS = DEMO_MEALS.length;

/** 生成 count 条演示记录，由近到远排序，日期恒为「今天」 */
export function buildDemoRecords(now: Date, count: number): MealRecord[] {
  const n = Math.min(DEMO_MAX_MEALS, Math.max(1, Math.floor(count) || 1));
  const date = localDateKey(now);
  return DEMO_MEALS.slice(0, n)
    .map((m, i) => {
      const d = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate(),
        m.hour,
        m.minute,
        0,
        0
      );
      return {
        id: `demo_${date}_${i}`,
        created_at: d.toISOString(),
        date,
        kcal: m.kcal,
        kcal_min: m.kcal_min,
        kcal_max: m.kcal_max,
        dish_labels: m.dish_labels,
        image: m.image,
        daily_target_kcal: DEMO_TARGET_KCAL,
        cat_id: m.cat_id,
      } satisfies MealRecord;
    })
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
}
