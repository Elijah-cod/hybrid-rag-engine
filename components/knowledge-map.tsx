"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import type { GraphPayload } from "@/lib/types";

const ForceGraph2D = dynamic(() => import("react-force-graph-2d"), {
  ssr: false
});

type ForceNode = {
  id: string;
  label: string;
  type?: string;
  highlighted?: boolean;
  x?: number;
  y?: number;
};

type KnowledgeMapProps = {
  graph: GraphPayload;
};

export function KnowledgeMap({ graph }: KnowledgeMapProps) {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const [dimensions, setDimensions] = useState({ width: 640, height: 420 });

  useEffect(() => {
    const element = wrapperRef.current;
    if (!element) {
      return;
    }

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) {
        return;
      }

      setDimensions({
        width: Math.max(320, Math.floor(entry.contentRect.width)),
        height: 420
      });
    });

    observer.observe(element);
    return () => observer.disconnect();
  }, [graph.nodes.length]);

  return (
    <div ref={wrapperRef}>
      {graph.nodes.length === 0 ? (
        <div className="empty-state">
          <div>
            <h3>No graph yet</h3>
            <p>
              Ask a question and this panel will render retrieved entities, relationship edges,
              and any shortest paths found in Neo4j.
            </p>
          </div>
        </div>
      ) : (
        <ForceGraph2D
          cooldownTicks={120}
          graphData={graph}
          height={dimensions.height}
          linkColor={() => "rgba(15, 118, 110, 0.35)"}
          linkDirectionalArrowLength={4}
          linkDirectionalArrowRelPos={1}
          linkLabel={(link: { relation?: string }) => link.relation || "RELATED"}
          linkWidth={(link: { highlighted?: boolean }) => (link.highlighted ? 2.8 : 1.4)}
          nodeAutoColorBy="group"
          nodeCanvasObject={(node: unknown, context: CanvasRenderingContext2D, globalScale: number) => {
            const typedNode = node as ForceNode;
            const label = typedNode.label || typedNode.id;
            const fontSize = typedNode.highlighted ? 14 / globalScale : 12 / globalScale;
            context.font = `600 ${fontSize}px "Avenir Next", sans-serif`;
            const textWidth = context.measureText(label).width;
            const backgroundPadding = 6 / globalScale;
            const x = typedNode.x || 0;
            const y = typedNode.y || 0;

            context.fillStyle = typedNode.highlighted ? "#0f766e" : "#1f2937";
            context.beginPath();
            context.arc(x, y, typedNode.highlighted ? 6 : 4.6, 0, 2 * Math.PI, false);
            context.fill();

            context.fillStyle = "rgba(255, 250, 240, 0.92)";
            context.fillRect(
              x + 8 / globalScale,
              y - fontSize,
              textWidth + backgroundPadding * 2,
              fontSize + backgroundPadding * 1.2
            );

            context.fillStyle = "#20160f";
            context.fillText(label, x + 8 / globalScale + backgroundPadding, y);
          }}
          nodeLabel={(node: ForceNode) => `${node.label}${node.type ? ` (${node.type})` : ""}`}
          width={dimensions.width}
        />
      )}
    </div>
  );
}
