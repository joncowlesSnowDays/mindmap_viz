import { Node, Edge } from "reactflow";

export function transformGPTToFlow(gptData: any, prevNodes: Node[], prevEdges: Edge[]): { nodes: Node[]; edges: Edge[] } {
  if (!gptData || !gptData.nodes) return { nodes: [], edges: [] };

  const nodes: Node[] = gptData.nodes.map((n: any) => ({
    id: n.id,
    type: n.preview ? "input" : "default",
    label: n.label, // <-- THIS FIXES BLANK LABELS
    data: {
      label: n.label,
      group: n.group,
      preview: !!n.preview,
      collapsed: !!n.collapsed,
      ...n,
    },
    position: n.position
      ? {
          x: n.position.x + (Math.random() - 0.5) * 60,
          y: n.position.y + (Math.random() - 0.5) * 60,
        }
      : { x: Math.random() * 600, y: Math.random() * 500 },
    parentNode: n.parentId || undefined,
    style: {
      border: n.preview ? "2px dashed #c026d3" : "1px solid #e5e7eb",
      opacity: n.preview ? 0.75 : 1,
      background: n.collapsed ? "#eee" : "#fff",
    },
  }));

  const edges: Edge[] = gptData.edges.map((e: any) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    label: e.type,
    style: {
      stroke: e.type === "informs" ? "#3b82f6"
        : e.type === "depends on" ? "#22c55e"
        : e.type === "related" ? "#f59e42"
        : "#444",
      strokeWidth: 2,
      strokeDasharray: e.preview ? "4 2" : undefined,
    },
    animated: !!e.preview,
  }));

  return { nodes, edges };
}

