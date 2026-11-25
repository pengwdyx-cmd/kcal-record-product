import ResultPage from './result-page';
import type { ResultPageInput } from './result-data';

/* ================================================================== */
/*  【数据接入点】结果页唯一入口，与确认页同一模式                       */
/*                                                                    */
/*  数据来源：确认页在「确认并计算」成功拿到工作流 2 响应后，            */
/*  把原始响应（含 data JSON 字符串）写入 sessionStorage 的             */
/*  calorie_result_v1，再 router.push('/result')。                      */
/*  本页 SSR 首屏传 null 占位，客户端挂载后由 ResultPage 读取            */
/*  sessionStorage 覆盖（避免 hydration 不一致）。                      */
/*  不新增 API、不虚构数据、不改工作流 2 Route。                        */
/* ================================================================== */

export default function Page() {
  return <ResultPage initialInput={null} />;
}
