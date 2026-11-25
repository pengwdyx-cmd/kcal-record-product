import StatsPage from './stats-page';

/* ================================================================== */
/*  统计页路由｜结果页「完成记录」跳转到此                              */
/*  数据来自本机 localStorage（calorie_meal_history_v1），              */
/*  客户端挂载后读取，SSR 首屏只输出占位，避免 hydration 不一致。        */
/* ================================================================== */

export default function Page() {
  return <StatsPage />;
}
