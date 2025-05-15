import { Node, Edge } from "react-flow";

/*
 Expected GPT output:
 {
   nodes: [
     { id: "concept-1", label: "Thrusters", group: "Propulsion", type: "concept", preview: false, collapsed: false, ... },
     ...
   ],
   edges: [
     { id: "edge-1", source: "concept-1", target: "concept-2", type: "informs" },
     ...
   ]
 }
*/
export function transformGPTToFlow(gptData: any, prevNodes: Node[], prevEdges: Edge[]): { nodes: Node[]; edges: Edge[] } {
  if (!gptData || !gptData.nodes) return { nodes: [], edges: [] };

  // Map node data to React Flow node format
  const nodes: Node[] = gptData.nodes.map((n: any) => ({
    id: n.id,
    type: n.preview ? "input" : "default",
    data: {
      label: n.label,
      group: n.group,
      preview: !!n.preview,
      collapsed: !!n.collapsed,
      ...n,
    },
    position: n.position || { x: Math.random() * 400, y: Math.random() * 300 },
    parentNode: n.parentId || undefined,
    style: {
      border: n.preview ? "2px dashed #c026d3" : "1px solid #e5e7eb",
      opacity: n.preview ? 0.75 : 1,
      background: n.collapsed ? "#eee" : "#fff",
    },
  }));

  // Map edges and apply color/type
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
