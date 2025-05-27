import { Node, Edge, MarkerType } from "reactflow";

/**
 * Merge newly expanded nodes/edges with the previous tree,
 * replacing only the children of expandedNodeId.
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

// --- Utility for random pastel edge colors ---
function randomColor() {
  const h = Math.floor(Math.random() * 360);
  return `hsl(${h}, 75%, 75%)`;
}

// --- Child map ---
export function getChildMap(edges: Edge[]) {
  const childMap: Record<string, string[]> = {};
  edges.forEach((e) => {
    if (!childMap[e.source]) childMap[e.source] = [];
    childMap[e.source].push(e.target);
  });
  return childMap;
}

// --- Descendant helper ---
export function getDescendantIds(nodeId: string, childMap: Record<string, string[]>, acc: string[] = []): string[] {
  const children = childMap[nodeId] || [];
  for (const c of children) {
    acc.push(c);
    getDescendantIds(c, childMap, acc);
  }
  return acc;
}

// Track colors for each level
const levelColors: { [key: number]: string } = {};

// Generate a consistent pastel color based on level
function generatePastelColor(level: number): string {
  // Use golden ratio for even color distribution
  const goldenRatio = 0.618033988749895;
  // Use level as a seed to generate consistent hue
  const hue = ((level * goldenRatio) % 1) * 360;
  // Adjust saturation and lightness based on level for better distinction
  const saturation = 85 - (level * 5); // Decrease saturation slightly for deeper levels
  const lightness = 85 + (level * 2); // Increase lightness slightly for deeper levels
  return `hsl(${hue}, ${saturation}%, ${lightness}%)`; 
}

// Get or generate color for a specific level
function getLevelColor(level: number): string {
  if (level === 0) return '#ffffff'; // Root is always white
  
  // Always regenerate the color if it doesn't exist for this level
  if (!levelColors[level]) {
    levelColors[level] = generatePastelColor(level);
  }
  
  // Return the cached color for this level
  return levelColors[level];
}

// Reset level colors (useful when creating a new mind map)
export function resetLevelColors() {
  Object.keys(levelColors).forEach(key => delete levelColors[Number(key)]);
}

// Calculate node levels using BFS
function calculateNodeLevels(nodes: any[], edges: any[]): Map<string, number> {
  const levels = new Map<string, number>();
  const rootNode = nodes.find(n => n.id === 'root');
  if (!rootNode) return levels;

  // Initialize with root
  levels.set(rootNode.id, 0);
  const queue = [rootNode.id];
  
  // Create adjacency list for faster lookups
  const adjacencyList = new Map<string, string[]>();
  edges.forEach(edge => {
    if (!adjacencyList.has(edge.source)) {
      adjacencyList.set(edge.source, []);
    }
    adjacencyList.get(edge.source)?.push(edge.target);
  });

  // BFS to assign levels
  while (queue.length > 0) {
    const currentId = queue.shift()!;
    const currentLevel = levels.get(currentId)!;
    
    // Process children
    const children = adjacencyList.get(currentId) || [];
    children.forEach(childId => {
      if (!levels.has(childId)) {
        levels.set(childId, currentLevel + 1);
        queue.push(childId);
      }
    });
  }

  return levels;
}

/*
 * Transforms GPT data to React Flow nodes and edges, with preview node style and arrow markers.
 */
export function transformGPTToFlow(gptData: any, isNewMindMap: boolean = false): { nodes: Node[]; edges: Edge[] } {
  if (!gptData || !gptData.nodes) return { nodes: [], edges: [] };

  // Only reset colors when creating a new mind map
  if (isNewMindMap) {
    resetLevelColors();
  }

  // Calculate levels for all nodes
  const nodeLevels = calculateNodeLevels(gptData.nodes, gptData.edges);

  // Map node data to React Flow node format
  const nodes: Node[] = gptData.nodes.map((n: any) => ({
    id: n.id,
    type: "mindMapNode",
    data: {
      label: n.label,
      group: n.group,
      preview: !!n.preview,
      collapsed: !!n.collapsed,
      ...n,
      isRoot: n.id === "root",
    },
    position: n.position || { x: Math.random() * 400, y: Math.random() * 300 },
    parentNode: n.parentId || undefined,
    draggable: true,
    style: {
      border: "1px solid #e5e7eb",
      opacity: n.preview ? 0.75 : 1,
      background: getLevelColor(nodeLevels.get(n.id) || 0),
    },
  }));

  // Map edges, random color, arrow, and NO LABEL
  const edges: Edge[] = gptData.edges.map((e: any) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    style: {
      stroke: e.type === 'informs' ? '#3b82f6' : 
             e.type === 'depends' ? '#22c55e' : 
             e.type === 'related' ? '#f59e42' : '#c026d3',
      strokeWidth: 1.5,
    },
    markerEnd: {
      type: MarkerType.ArrowClosed,
      width: 20,
      height: 20,
      color: e.type === 'informs' ? '#3b82f6' : 
             e.type === 'depends' ? '#22c55e' : 
             e.type === 'related' ? '#f59e42' : '#c026d3',
    },
    animated: !!e.preview,
    type: 'smoothstep'
  }));

  return { nodes, edges };
}

/**
 * Preserve positions of existing nodes and their descendants.
 * Returns a map of node IDs to their positions.
 */
export function preserveExistingPositions(
  nodes: Node[],
  edges: Edge[],
  existingPositions: Record<string, {x: number, y: number}> = {},
  nodeId?: string
): Record<string, {x: number, y: number}> {
  // Create a new map to store positions
  const positions = { ...existingPositions };
  
  // Get child map for finding descendants
  const childMap = getChildMap(edges);

  // If a specific node is provided, get its descendants
  const descendants = nodeId ? getDescendantIds(nodeId, childMap) : [];
  
  // Store current positions for all nodes
  nodes.forEach(n => {
    // Store position for the current node if it has one
    if (n.position) {
      positions[n.id] = { ...n.position };
    }
    
    // If this is a specific node we're expanding, also ensure we store its descendants
    if (nodeId && n.id === nodeId) {
      descendants.forEach(descId => {
        const desc = nodes.find(d => d.id === descId);
        if (desc) {
          positions[descId] = { ...desc.position };
        }
      });
    }
  });

  return positions;
}
