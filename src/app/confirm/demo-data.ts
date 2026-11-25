import type { Workflow1ConfirmOutput } from './confirm-data';

/* ================================================================== */
/*  【本地开发 fallback｜模拟数据，不是 Coze 工作流 1 的真实输出】       */
/*                                                                    */
/*  字段结构严格照抄工作流 1 结束节点输出：                            */
/*    { meal_image, confirmation_dishes }                             */
/*  字段值（菜名、克重、营养数值等）均为本地模拟数据，                  */
/*  不代表真实识别结果或真实营养库数据。                               */
/*                                                                    */
/*  接入 Coze 时：在 confirm/page.tsx 用工作流 1 的真实输出替换本对象， */
/*  confirm-page.tsx 不需要任何改动。                                  */
/* ================================================================== */

export const DEMO_WORKFLOW1_OUTPUT: Workflow1ConfirmOutput = {
  // 本地 demo 图片资源，仅用于无 API 时让页面跑通；真实值由工作流 1 提供
  meal_image: '/meal-demo.svg',
  confirmation_dishes: [
    {
      dish_id: 'dish_1',
      dish_label: '炸鱿鱼须',
      cooking_method_code: 'SHALLOW_FRY_OR_BATTER_FRY',
      method_display_name: '浅炸／裹粉煎炸',
      method_needs_confirm: true,
      oil_rule_found: true,
      oil_min_g_per_100g: 12,
      oil_max_g_per_100g: 25,
      ingredients: [
        {
          dish_id: 'dish_1',
          ingredient_name: '鱿鱼',
          estimated_weight_g: 220,
          food_state_code: 'COOKED',
          name_needs_confirm: false,
          weight_needs_confirm: true,
          nutrition_status: 'ambiguous',
          reference_id: '1130',
          reference_name: '鱿鱼(干)[台湾枪乌贼]',
          energy_kj_per_100g: 1323,
          reference_state_code: 'raw',
          calculation_path: 'raw_pending',
          block_reason: 'ambiguous_candidate',
          energy_includes_oil: false,
        },
        {
          dish_id: 'dish_1',
          ingredient_name: '淀粉',
          estimated_weight_g: 30,
          food_state_code: 'COOKED',
          name_needs_confirm: true,
          weight_needs_confirm: false,
          nutrition_status: 'unresolved',
          reference_id: '',
          reference_name: '',
          energy_kj_per_100g: 0,
          reference_state_code: 'raw',
          calculation_path: 'blocked',
          block_reason: 'composite_component',
          energy_includes_oil: false,
        },
      ],
    },
    {
      dish_id: 'dish_2',
      dish_label: '米饭',
      cooking_method_code: 'RAW_STEAM_BOIL',
      method_display_name: '生食／蒸／水煮',
      method_needs_confirm: false,
      oil_rule_found: true,
      oil_min_g_per_100g: 0,
      oil_max_g_per_100g: 0,
      ingredients: [
        {
          dish_id: 'dish_2',
          ingredient_name: '米饭',
          estimated_weight_g: 150,
          food_state_code: 'COOKED',
          name_needs_confirm: false,
          weight_needs_confirm: true,
          nutrition_status: 'exact',
          reference_id: '0124',
          reference_name: '米饭(蒸)',
          energy_kj_per_100g: 486,
          reference_state_code: 'direct',
          calculation_path: 'direct',
          block_reason: '',
          energy_includes_oil: false,
        },
      ],
    },
  ],
};
