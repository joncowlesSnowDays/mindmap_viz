import { Node, Edge, MarkerType } from "reactflow";

/**
 * Merge newly expanded nodes/edges with the previous tree, replacing only the children of expandedNodeId.
 */
export function mergeExpandedNodesAndEdges(
  prevNodes: Node[],
  prevEdges: Edge[],
  newNodes: Node[],
  newEdges: Edge[],
  expandedNodeId: string
): { nodes: Node[]; edges: Edge[] } {
  // Remove existing children of the expanded node (and their downstream edges)
  const oldChildrenIds = prevEdges
    .filter(e => e.source === expandedNodeId)
    .map(e => e.target);

  // Remove those children from the previous nodes and their edges
  const filteredNodes = prevNodes.filter(
    n => !oldChildrenIds.includes(n.id)
  );
  const filteredEdges = prevEdges.filter(
    e => !(e.source === expandedNodeId && oldChildrenIds.includes(e.target))
  );

  // Add in new children and their edges
  return {
    nodes: [...filteredNodes, ...newNodes],
    edges: [...filteredEdges, ...newEdges]
  };
}

/*
 * Transforms GPT data to React Flow nodes and edges, with preview node style and arrow markers.
 */
export function transformGPTToFlow(gptData: any): { nodes: Node[]; edges: Edge[] } {
  if (!gptData || !gptData.nodes) return { nodes: [], edges: [] };

  // Map node data to React Flow node format
  const nodes: Node[] = gptData.nodes.map((n: any) => ({
    id: n.id,
    type: "default", // Always use "default" for compatibility
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
      border: "1px solid #e5e7eb",
      opacity: n.preview ? 0.75 : 1,
      background: n.preview ? "#f9f5ff" : "#fff",
    },
  }));

  // Map edges, style with color, and add arrows
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
    },
    markerEnd: { type: MarkerType.ArrowClosed },
    animated: !!e.preview,
    type: "default"
  }));

  return { nodes, edges };
}
