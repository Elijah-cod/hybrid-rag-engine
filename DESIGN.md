---
name: Synthetic Intelligence Blueprint
colors:
  background: "#0b0e14"
  surface: "#10131a"
  surface-low: "#14181f"
  surface-mid: "#1b1f27"
  surface-high: "#272a31"
  line: "rgba(225, 253, 255, 0.11)"
  text: "#e1e2eb"
  text-soft: "#b9c4d2"
  muted: "#8d9aaf"
  primary: "#00f2ff"
  primary-soft: "#74f5ff"
  success: "#67f4b7"
  secondary: "#adc6ff"
  danger: "#ffb4ab"
typography:
  ui:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: "400"
    lineHeight: "1.6"
  heading:
    fontFamily: Inter
    fontSize: 32px
    fontWeight: "600"
    lineHeight: "1.2"
  label:
    fontFamily: JetBrains Mono
    fontSize: 12px
    fontWeight: "600"
    lineHeight: "1"
    letterSpacing: 0.08em
rounded:
  panel: 5px
  control: 4px
  pill: 999px
spacing:
  page: 40px
  gutter: 24px
  panel-gap: 12px
---

## Direction

InsightGraph follows the supplied Stitch "Synthetic Intelligence Blueprint." It is a dense, desktop-first AI-native knowledge workspace, not a marketing landing page. The interface must expose graph structure, semantic evidence, source ingestion, schema, and traces as parts of one persistent operating environment.

## Structure

- A fixed left rail owns product navigation and workspace creation.
- A compact top bar switches between Visualizer, Query Engine, and History.
- Knowledge Map is the primary workspace, with graph canvas, evidence inspector, and bottom query composer.
- Data Sources owns ingestion and source-library management.
- Schema Builder, Trace Logs, and Settings use dedicated technical workspaces.
- Tablet collapses wide panels; mobile replaces the left rail with icon navigation and stacks content vertically.

## Visual Language

- Use deep charcoal surfaces and thin, high-contrast borders for technical density.
- Cyan identifies active navigation, primary actions, graph nodes, and live states.
- Emerald identifies successful or connected states.
- Inter carries product content; JetBrains Mono carries labels, IDs, modes, traces, and metadata.
- Panels use tonal layering and restrained translucency. Corners remain compact and precise.
- Grid backgrounds belong on graph and schema canvases, not on every surface.

## Interaction

- Navigation changes views without losing query, source, or graph state.
- Switching views resets the workspace scroll position.
- Mock AI must remain fully functional without cloud quotas and should produce meaningful nodes, edges, paths, and evidence.
- Empty states explain the next action. Errors offer a plain-language local fallback.
- Motion communicates active data flow only; avoid decorative page choreography.
