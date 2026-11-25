# DESIGN.md

## 品牌与视觉方向

卡路里记录 AI 应用 — 清新自然的轻健康风格，简洁、现代、有亲和力。
意象锚点：清晨厨房里的一束自然光，木质桌面上摆着一碗新鲜的沙拉，旁边放着手机随手拍下的食物照片。

## Design Tokens

### 色彩

| Token | 色值 | 用途 |
|-------|------|------|
| `--brand-green` | #315C45 | 品牌深绿，用于品牌标识、标题强调 |
| `--primary-green` | #6F9B7B | 主操作绿，用于按钮、交互元素 |
| `--page-bg` | #F5F8F5 | 页面背景色 |
| `--card-bg` | #FFFFFF | 卡片白色背景 |
| `--text-primary` | #25332B | 主要文字色 |
| `--text-secondary` | #829087 | 辅助文字色 |
| `--warm-accent` | #F3EBD9 | 温暖点缀色，用于图标背景、柔和高亮 |
| `--pending-bg` | #FFF8E7 | 待确认字段背景色，柔和浅黄 |
| `--pending-border` | #F5E6B8 | 待确认字段边框色 |
| `--pending-text` | #8B6914 | 待确认字段文字色，清晰但不刺眼 |

### 圆角

- 卡片圆角：16px
- 按钮圆角：12px
- 小元素圆角：8px

### 阴影

- 卡片阴影：柔和扩散阴影 `0 4px 24px rgba(49, 92, 69, 0.08)`
- 悬浮阴影：`0 8px 32px rgba(49, 92, 69, 0.12)`

### 字体

- 字体族：PingFang SC, Hiragino Sans GB, Microsoft YaHei, system-ui
- 主标题：24px / 600 weight
- 副标题：15px / 400 weight
- 按钮文字：16px / 500 weight

## 动效与交互

- 上传区域 hover：边框颜色加深，背景微变
- 拖拽进入：虚线边框变实线，背景色轻微变化
- 按钮过渡：opacity + transform，200ms ease
- 图片预览出现：fade-in + scale，300ms ease

## 设计禁忌

- 不要使用传统医疗软件的冷蓝色调
- 不要使用过于鲜艳的渐变色
- 不要添加不必要的图表、统计数据、导航菜单
- 不要使用过于厚重的阴影或边框
- 不要使用纯黑 (#000000) 作为文字色
