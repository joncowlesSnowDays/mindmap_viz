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

// --- Utility for random colors ---
function randomColor() {
  // Pastel random color
  const h = Math.floor(Math.random() * 360);
  return `hsl(${h}, 75%, 75%)`;
}

/*
 * Transforms GPT data to React Flow nodes and edges, with preview node style and arrow markers.
 */
export function transformGPTToFlow(gptData: any): { nodes: Node[]; edges: Edge[] } {
  if (!gptData || !gptData.nodes) return { nodes: [], edges: [] };

  // Map node data to React Flow node format
  const nodes: Node[] = gptData.nodes.map((n: any) => ({
    id: n.id,
    type: "default",
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

  // Map edges, random color, arrow, and NO LABEL
  const edges: Edge[] = gptData.edges.map((e: any) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    // label: e.type, // REMOVE LABEL
    style: {
      stroke: randomColor(),
      strokeWidth: 2,
    },
    markerEnd: { type: MarkerType.ArrowClosed },
    animated: !!e.preview,
    type: "default"
  }));

  return { nodes, edges };
}
