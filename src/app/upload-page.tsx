'use client';

import { useState, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  CONFIRM_INPUT_STORAGE_KEY,
  isWorkflow1Success,
  type ConfirmPageInput,
  type Workflow1RouteResponse,
} from './confirm/confirm-data';

/** 每日目标热量的默认值与输入边界（仅用于本页输入控件，不是确认页写死值） */
const DEFAULT_DAILY_TARGET_KCAL = 2000;
const MIN_DAILY_TARGET_KCAL = 1;
const MAX_DAILY_TARGET_KCAL = 10000;
/** 图片压缩参数：控制 dataURL 体积，避免撑爆 sessionStorage 配额 */
const IMAGE_MAX_EDGE = 1200;
const IMAGE_JPEG_QUALITY = 0.72;
/** sessionStorage 单条载荷的安全上限（字符数），超出则只传目标热量 */
const MAX_PAYLOAD_CHARS = 4 * 1024 * 1024;

export default function UploadPage() {
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [dailyTargetKcal, setDailyTargetKcal] = useState<number>(
    DEFAULT_DAILY_TARGET_KCAL
  );
  const [isDragging, setIsDragging] = useState(false);
  const [showToast, setShowToast] = useState(false);
  const [toastMessage, setToastMessage] = useState('');
  /** 工作流 1 识别中，防止重复点击 */
  const [isSubmitting, setIsSubmitting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  const handleFileSelect = useCallback((file: File) => {
    if (!file.type.startsWith('image/')) return;
    const validTypes = ['image/jpeg', 'image/png', 'image/jpg'];
    if (!validTypes.includes(file.type)) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      const rawDataUrl = e.target?.result as string;
      // 压缩图片：原图 dataURL 可能数 MB，直接存 sessionStorage 会超配额。
      // 用 canvas 缩放到最长边 1200 并以 JPEG 0.72 重编码，通常降到 100-300KB。
      const img = new Image();
      img.onload = () => {
        try {
          let width = img.width;
          let height = img.height;
          const longest = Math.max(width, height);
          if (longest > IMAGE_MAX_EDGE) {
            const ratio = IMAGE_MAX_EDGE / longest;
            width = Math.round(width * ratio);
            height = Math.round(height * ratio);
          }
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            setSelectedImage(rawDataUrl);
            return;
          }
          ctx.drawImage(img, 0, 0, width, height);
          setSelectedImage(canvas.toDataURL('image/jpeg', IMAGE_JPEG_QUALITY));
        } catch {
          // 压缩失败时退回原图，保证上传交互不中断
          setSelectedImage(rawDataUrl);
        }
      };
      img.onerror = () => setSelectedImage(rawDataUrl);
      img.src = rawDataUrl;
    };
    reader.readAsDataURL(file);
  }, []);

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) handleFileSelect(file);
    },
    [handleFileSelect]
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(false);

      const file = e.dataTransfer.files?.[0];
      if (file) handleFileSelect(file);
    },
    [handleFileSelect]
  );

  const handleRemoveImage = useCallback(() => {
    setSelectedImage(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, []);

  const handleReselect = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleTargetChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const raw = e.target.value;
      if (raw.trim() === '') return;
      const parsed = Number(raw);
      if (!Number.isFinite(parsed)) return;
      const clamped = Math.min(
        MAX_DAILY_TARGET_KCAL,
        Math.max(MIN_DAILY_TARGET_KCAL, Math.round(parsed))
      );
      setDailyTargetKcal(clamped);
    },
    []
  );

  /** 统一的错误提示：停留在上传页，不跳转 */
  const showError = useCallback((message: string) => {
    setToastMessage(message);
    setShowToast(true);
    setTimeout(() => setShowToast(false), 5000);
  }, []);

  /**
   * 点击「开始识别」：调用本地工作流 1 Route（服务端上传图片到 Coze 并执行识别）。
   * 只有「API 成功 + confirmation_dishes 校验通过 + 跨页载荷写入成功」才跳转确认页；
   * 任何失败都停留在上传页并给出提示。
   */
  const handleIdentify = useCallback(async () => {
    if (!selectedImage || isSubmitting) return;
    setIsSubmitting(true);

    try {
      const response = await fetch('/api/coze/workflow1', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          meal_image: selectedImage,
          daily_target_kcal: dailyTargetKcal,
        }),
      });

      let result: Workflow1RouteResponse;
      try {
        result = (await response.json()) as Workflow1RouteResponse;
      } catch {
        showError('识别服务返回异常，请稍后重试');
        return;
      }

      // 失败：不跳转，提示错误（优先用服务端给出的明确文案）
      if (!response.ok || !isWorkflow1Success(result)) {
        const message = !result.success && result.error
          ? result.error
          : '图片识别失败，请稍后重试';
        showError(message);
        return;
      }

      // 成功：把图片、目标热量、真实识别结果、本次执行调试信息写入 sessionStorage
      const payload: ConfirmPageInput = {
        meal_image: selectedImage,
        daily_target_kcal: dailyTargetKcal,
        confirmation_dishes: result.confirmation_dishes,
        // 调试元信息为可选字段：仅用于确认页展示 Coze 试运行链接与耗时，
        // 不进入 confirmation_dishes，也不会传给工作流 2。
        ...(result.debug_url
          ? { workflow1_debug_url: result.debug_url }
          : {}),
        ...(result.execute_id
          ? { workflow1_execute_id: result.execute_id }
          : {}),
        ...(typeof result.upload_ms === 'number'
          ? { workflow1_upload_ms: result.upload_ms }
          : {}),
        ...(typeof result.workflow_ms === 'number'
          ? { workflow1_workflow_ms: result.workflow_ms }
          : {}),
      };
      const serialized = JSON.stringify(payload);
      if (serialized.length > MAX_PAYLOAD_CHARS) {
        showError('识别结果过大，未能传递，请换一张更小的图片');
        return;
      }
      try {
        sessionStorage.setItem(CONFIRM_INPUT_STORAGE_KEY, serialized);
      } catch {
        showError('浏览器存储不可用，无法传递到确认页');
        return;
      }

      // 目标热量同时放 URL query，作为 sessionStorage 之外的双保险
      const query = `?daily_target_kcal=${encodeURIComponent(dailyTargetKcal)}`;
      router.push(`/confirm${query}`);
    } catch {
      showError('网络异常，图片识别失败，请稍后重试');
    } finally {
      setIsSubmitting(false);
    }
  }, [selectedImage, dailyTargetKcal, router, isSubmitting, showError]);

  return (
    <div
      className="min-h-screen flex flex-col items-center px-4 py-8 sm:py-12"
      style={{ backgroundColor: 'var(--page-bg)' }}
    >
      {/* Brand Header */}
      <header className="flex items-center gap-2 mb-8 sm:mb-12">
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
      </header>

      {/* Title Section */}
      <div className="text-center mb-8 sm:mb-10 max-w-md">
        <h1
          className="text-2xl sm:text-[28px] font-semibold leading-snug mb-3"
          style={{ color: 'var(--text-primary)' }}
        >
          记录每一餐，了解每一份热量
        </h1>
        <p
          className="text-[15px] leading-relaxed"
          style={{ color: 'var(--text-secondary)' }}
        >
          拍下食物照片，AI 帮你识别菜品与营养信息。
        </p>
      </div>

      {/* Upload Card */}
      <div
        className="w-full max-w-md rounded-2xl p-6 sm:p-8 mb-6 transition-shadow duration-300"
        style={{
          backgroundColor: 'var(--card-bg)',
          boxShadow: 'var(--card-shadow)',
          borderRadius: '16px',
        }}
      >
        {!selectedImage ? (
          /* Upload Area */
          <div
            className="relative border-2 border-dashed rounded-xl p-8 sm:p-12 flex flex-col items-center justify-center cursor-pointer transition-all duration-200"
            style={{
              borderColor: isDragging
                ? 'var(--primary-green)'
                : '#d4ddd7',
              backgroundColor: isDragging
                ? 'rgba(111, 155, 123, 0.06)'
                : 'transparent',
            }}
            onClick={() => fileInputRef.current?.click()}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            {/* Icon */}
            <div
              className="w-16 h-16 rounded-full flex items-center justify-center mb-4"
              style={{ backgroundColor: 'var(--warm-accent)' }}
            >
              <svg
                width="28"
                height="28"
                viewBox="0 0 24 24"
                fill="none"
                stroke="var(--brand-green)"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M14.5 4h-5l-1.5 1.5h-3A1.5 1.5 0 0 0 2.5 7v10A1.5 1.5 0 0 0 4 18.5h16a1.5 1.5 0 0 0 1.5-1.5v-10A1.5 1.5 0 0 0 20 5.5h-3L14.5 4z" />
                <circle cx="12" cy="12" r="3.5" />
                <path d="M8 7.5h.01" />
              </svg>
            </div>

            {/* Text */}
            <p
              className="text-base font-medium mb-1.5"
              style={{ color: 'var(--text-primary)' }}
            >
              上传食物照片
            </p>
            <p
              className="text-sm"
              style={{ color: 'var(--text-secondary)' }}
            >
              支持 JPG、PNG 格式
            </p>

            {/* Hidden Input */}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/jpg"
              className="hidden"
              onChange={handleInputChange}
            />
          </div>
        ) : (
          /* Image Preview */
          <div className="flex flex-col items-center">
            <div className="relative w-full aspect-square max-w-[280px] rounded-xl overflow-hidden mb-4">
              <img
                src={selectedImage}
                alt="已上传的食物照片"
                className="w-full h-full object-cover animate-fade-in-scale"
              />
              {/* Delete Button */}
              <button
                onClick={handleRemoveImage}
                className="absolute top-2 right-2 w-8 h-8 rounded-full flex items-center justify-center transition-opacity duration-200 hover:opacity-80"
                style={{
                  backgroundColor: 'rgba(37, 51, 43, 0.6)',
                  backdropFilter: 'blur(4px)',
                }}
                aria-label="删除图片"
              >
                <svg
                  width="16"
                  height="16"
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

            {/* Reselect Button */}
            <button
              onClick={handleReselect}
              className="text-sm font-medium transition-colors duration-200 hover:underline"
              style={{ color: 'var(--primary-green)' }}
            >
              重新选择
            </button>

            {/* Hidden Input for Reselect */}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/jpg"
              className="hidden"
              onChange={handleInputChange}
            />
          </div>
        )}

        {/* Daily Target Input：沿用卡片视觉风格，用户输入自己的每日目标热量 */}
        <div className="mt-5 pt-5" style={{ borderTop: '1px solid #eef2ef' }}>
          <label
            htmlFor="daily-target-kcal"
            className="block text-sm font-medium mb-2"
            style={{ color: 'var(--text-primary)' }}
          >
            每日目标热量
          </label>
          <div className="flex items-center gap-2">
            <input
              id="daily-target-kcal"
              type="number"
              inputMode="numeric"
              min={MIN_DAILY_TARGET_KCAL}
              max={MAX_DAILY_TARGET_KCAL}
              step={50}
              value={dailyTargetKcal}
              onChange={handleTargetChange}
              className="w-full text-base py-2.5 px-3 rounded-lg border outline-none transition-colors focus:ring-2 focus:ring-[var(--primary-green)]/30"
              style={{
                borderColor: '#e2e8e4',
                backgroundColor: '#fafcfb',
                color: 'var(--text-primary)',
              }}
            />
            <span
              className="text-sm flex-shrink-0"
              style={{ color: 'var(--text-secondary)' }}
            >
              kcal
            </span>
          </div>
          <p
            className="text-xs mt-1.5 leading-relaxed"
            style={{ color: 'var(--text-secondary)' }}
          >
            用于计算今日摄入占比，可随时修改。
          </p>
        </div>
      </div>

      {/* Action Button */}
      <button
        onClick={handleIdentify}
        disabled={!selectedImage || isSubmitting}
        className="w-full max-w-md py-3.5 rounded-xl text-base font-medium transition-all duration-200"
        style={{
          backgroundColor: selectedImage
            ? 'var(--primary-green)'
            : '#c8d5cc',
          color: selectedImage ? '#ffffff' : 'rgba(255,255,255,0.7)',
          borderRadius: '12px',
          cursor: selectedImage && !isSubmitting ? 'pointer' : 'not-allowed',
          boxShadow: selectedImage
            ? '0 4px 12px rgba(111, 155, 123, 0.3)'
            : 'none',
          opacity: isSubmitting ? 0.7 : 1,
        }}
      >
        {isSubmitting ? '识别中…' : '开始识别'}
      </button>

      {/* Disclaimer */}
      <p
        className="mt-6 text-xs text-center"
        style={{ color: 'var(--text-secondary)' }}
      >
        AI 估算结果仅供饮食记录参考
      </p>

      {/* Toast Notification */}
      {showToast && (
        <div
          className="fixed bottom-8 left-1/2 -translate-x-1/2 px-5 py-3 rounded-xl text-sm font-medium shadow-lg animate-fade-in-up"
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
