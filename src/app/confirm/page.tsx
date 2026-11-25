import ConfirmPage from './confirm-page';
import { DEMO_WORKFLOW1_OUTPUT } from './demo-data';

/* ================================================================== */
/*  【数据接入点】确认页唯一的数据入口                                 */
/*                                                                    */
/*  当前阶段（Demo）：使用本地 fallback，结构＝工作流 1 结束节点输出： */
/*    { meal_image, confirmation_dishes }                             */
/*  daily_target_kcal 来自上传页用户输入（sessionStorage），不是工作流 1 */
/*  字段；下方常量只作为 SSR 首屏占位，客户端挂载后由真实值覆盖。        */
/*                                                                    */
/*  下一步接入 Coze 时：把这里的 DEMO_WORKFLOW1_OUTPUT 换成            */
/*  工作流 1 结束节点的真实输出（或从上层／服务端取到的该输出），       */
/*  按字段名解构后传入 ConfirmPage 即可，组件无需改动。                */
/*  本次不猜测 API 地址、不设计接口、不新增后端。                      */
/* ================================================================== */

const { meal_image, confirmation_dishes } = DEMO_WORKFLOW1_OUTPUT;
/** SSR 首屏占位值；真实值由确认页客户端从 sessionStorage 读取覆盖 */
const SSR_FALLBACK_DAILY_TARGET_KCAL = 2000;

export default function Page() {
  return (
    <ConfirmPage
      mealImage={meal_image}
      initialConfirmationDishes={confirmation_dishes}
      initialDailyTargetKcal={SSR_FALLBACK_DAILY_TARGET_KCAL}
    />
  );
}
