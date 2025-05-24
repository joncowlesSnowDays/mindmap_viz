import { Node, Edge } from "reactflow";

// Merge logic: Merge only new nodes/edges, keep all old ones
export function mergeNodesEdges(
  prevNodes: Node[],
  prevEdges: Edge[],
  newNodes: Node[],
  newEdges: Edge[]
): { nodes: Node[], edges: Edge[] } {
  // Merge nodes by ID, don't overwrite old ones (keep old style/preview state)
  const nodeMap = Object.fromEntries(prevNodes.map(n => [n.id, n]));
  for (const n of newNodes) {
    if (!nodeMap[n.id]) nodeMap[n.id] = n;
  }
  // Merge edges by ID, skip duplicates
  const edgeMap = Object.fromEntries(prevEdges.map(e => [e.id, e]));
  for (const e of newEdges) {
    if (!edgeMap[e.id]) edgeMap[e.id] = e;
  }
  return { nodes: Object.values(nodeMap), edges: Object.values(edgeMap) };
}

export function transformGPTToFlow(
  gptData: any,
  prevNodes: Node[],
  prevEdges: Edge[]
): { nodes: Node[]; edges: Edge[] } {
  if (!gptData || !gptData.nodes) return { nodes: [], edges: [] };

  // Map new GPT nodes
  const newNodes: Node[] = gptData.nodes.map((n: any) => ({
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

  // Map new GPT edges
  const newEdges: Edge[] = gptData.edges.map((e: any) => ({
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

  // Merge new with old
  return mergeNodesEdges(prevNodes, prevEdges, newNodes, newEdges);
}
