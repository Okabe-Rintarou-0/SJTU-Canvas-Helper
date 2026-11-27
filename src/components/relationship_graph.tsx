import G6, { type Graph, type GraphData } from "@antv/g6";
import { Box, CircularProgress, Typography } from "@mui/material";
import { useEffect, useRef } from "react";

import { useRelationship } from "../lib/hooks";

const graphOpt = {
  fitView: true,
  modes: {
    default: [
      "drag-canvas",
      "zoom-canvas",
      "drag-node",
      { type: "activate-relations", activeState: "active", inactiveState: "inactive" },
    ],
  },
  layout: {
    type: "force",
    preventOverlap: true,
    nodeSize: 150,
  },
  defaultNode: {
    size: [80],
  },
  defaultEdge: {
    size: 1,
    color: "#e2e2e2",
  },
};

export default function RelationshipGraph() {
  const ref = useRef<HTMLDivElement>(null);
  const graph = useRef<Graph | null>(null);
  const relationship = useRelationship();

  useEffect(() => {
    const container = ref.current;
    if (!container) return;
    const g = new G6.Graph({
      container,
      width: container.clientWidth,
      height: container.clientHeight,
      ...graphOpt,
    });
    graph.current = g;
    g.get("canvas").set("localRefresh", false);
    const resize = () => {
      if (graph.current === g) g.changeSize(container.clientWidth, container.clientHeight);
    };
    window.addEventListener("resize", resize);
    return () => {
      window.removeEventListener("resize", resize);
      graph.current = null;
      g.destroy();
    };
  }, []);

  useEffect(() => {
    const g = graph.current;
    if (!g) return;
    g.clear();
    const topo = relationship.data;
    if (topo) {
      const nodes = topo.nodes.map((node) => {
        switch (node.nodeType) {
          case "Me":
            return {
              id: node.id,
              label: node.label,
              style: { fill: "#FFC1C1", stroke: "#FF6A6A" },
            };
          case "Course":
            return {
              id: node.id,
              label: node.label,
              style: { fill: "#6495ED" },
            };
          default:
            return { id: node.id, label: node.label };
        }
      });

      g.data({ nodes, edges: topo.edges } as GraphData);
      g.render();
    }
  }, [relationship.data]);

  return (
    <Box sx={{ position: "relative", overflow: "hidden" }}>
      {relationship.isLoading ? (
        <Box
          sx={{
            position: "absolute",
            inset: 0,
            zIndex: 1,
            display: "grid",
            placeItems: "center",
            bgcolor: "rgba(255,255,255,0.72)",
            backdropFilter: "blur(4px)",
          }}
        >
          <Box sx={{ textAlign: "center" }}>
            <CircularProgress />
            <Typography variant="body2" sx={{ mt: 1.5 }}>
              计算中，请耐心等待...
            </Typography>
          </Box>
        </Box>
      ) : null}
      <Box sx={{ height: "100vh", width: "100%" }} ref={ref} />
    </Box>
  );
}
