---
name: InsightGraph Ops Console
colors:
  background: "#0a0f17"
  background-elevated: "#101826"
  surface: "#101825"
  surface-muted: "#172233"
  surface-strong: "#1d2b3f"
  surface-panel: "rgba(16, 24, 37, 0.84)"
  surface-panel-strong: "rgba(22, 33, 49, 0.96)"
  line: "rgba(150, 180, 220, 0.16)"
  line-strong: "rgba(80, 217, 255, 0.28)"
  text: "#ecf6ff"
  text-muted: "#9fb1c8"
  text-soft: "#7e91ab"
  primary: "#4fd9ff"
  primary-strong: "#1eb7e4"
  success: "#59e6a7"
  warning: "#ffbf69"
  danger: "#ff7c88"
  glow: "rgba(79, 217, 255, 0.22)"
  grid: "rgba(255, 255, 255, 0.045)"
typography:
  display:
    fontFamily: Inter
    fontSize: 56px
    fontWeight: "700"
    lineHeight: "1"
    letterSpacing: -0.04em
  headline:
    fontFamily: Inter
    fontSize: 28px
    fontWeight: "650"
    lineHeight: "1.1"
  title:
    fontFamily: Inter
    fontSize: 18px
    fontWeight: "600"
    lineHeight: "1.3"
  body:
    fontFamily: Inter
    fontSize: 15px
    fontWeight: "400"
    lineHeight: "1.6"
  ui:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: "500"
    lineHeight: "1.4"
  mono:
    fontFamily: JetBrains Mono
    fontSize: 12px
    fontWeight: "600"
    lineHeight: "1.4"
rounded:
  panel: 28px
  card: 18px
  chip: 999px
spacing:
  page: 28px
  panel-gap: 18px
  card-gap: 12px
---

## Brand & Style

InsightGraph should feel like a modern AI operations console: sharp, dark, and deliberate. The visual personality is product-first, not marketing-first. Surfaces should communicate traceability, system state, and workflow readiness.

## Layout

Use a wide desktop shell with strong left-to-right flow:
- Primary command surface on the left.
- System state and explainability panels on the right.
- Dense but readable cards, with breathing room created by sectional rhythm rather than oversized whitespace.

## Components

- Panels should feel structural, not floaty.
- Chips and badges should communicate mode, source scope, and connector status.
- Empty states should explain the next useful action.
- Status and fallback guidance should be visible without opening a separate settings page.

## Motion

Keep transitions quick and subtle. Hover, focus, and load states should feel responsive and technical. Avoid ornamental animation except for very light grid/glow behavior that reinforces the “live system” feeling.
