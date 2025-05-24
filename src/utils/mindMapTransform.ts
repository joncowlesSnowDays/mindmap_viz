import { Node, Edge } from "reactflow";

export function transformGPTToFlow(
  gptData: any,
  prevNodes: Node[],
  prevEdges: Edge[]
): { nodes: Node[]; edges: Edge[] } {
  if (!gptData || !Array.isArray(gptData.nodes)) return { nodes: [], edges: [] };

  const nodes: Node[] = gptData.nodes.map((n: any) => ({
    id: String(n.id),
    type: n.preview ? "input" : "default",
    data: {
      label: (n.label && String(n.label).trim().length > 0) ? n.label : String(n.id),
      group: n.group,
      preview: !!n.preview,
      collapsed: !!n.collapsed,
      ...n,
    },
    position: (n.position && typeof n.position.x === "number" && typeof n.position.y === "number")
      ? n.position
      : { x: Math.random() * 400, y: Math.random() * 300 },
    parentNode: n.parentId ? String(n.parentId) : undefined,
    style: {
      border: n.preview ? "2px dashed #c026d3" : "1px solid #e5e7eb",
      opacity: n.preview ? 0.75 : 1,
      background: n.collapsed ? "#eee" : "#fff",
      ...(n.style || {}) // Allow LLM to add styles if needed
    },
  }));

  const edges: Edge[] = Array.isArray(gptData.edges) ? gptData.edges.map((e: any) => ({
    id: String(e.id),
    source: String(e.source),
    target: String(e.target),
    label: e.type,
    style: {
      stroke:
        e.type === "informs"
          ? "#3b82f6"
          : e.type === "depends on"
          ? "#22c55e"
          : e.type === "related"
          ? "#f59e42"
          : "#444",
      strokeWidth: 2,
      strokeDasharray: e.preview ? "4 2" : undefined,
      ...(e.style || {}),
    },
    animated: !!e.preview,
  })) : [];

  return { nodes, edges };
}
