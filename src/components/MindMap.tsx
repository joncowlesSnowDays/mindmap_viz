import React, { useEffect, useCallback, useRef } from "react";
import ReactFlow, {
  MiniMap,
  Controls,
  Background,
  useNodesState,
  useEdgesState,
  addEdge,
  Node,
  Edge,
  Connection,
  MarkerType,
} from "reactflow";
import "reactflow/dist/style.css";
import { useGPT } from "../hooks/useGPT.ts";
import { transformGPTToFlow } from "../utils/mindMapTransform.ts";
import Legend from "./Legend.tsx";

interface MindMapProps {
  userQuery: string;
  triggerUpdate: number;
}

const fitViewOptions = {
  padding: 0.2,
  includeHiddenNodes: true,
};

const centerX = 400;
const centerY = 300;
const layerRadius = 180;

// --- MULTI-LAYER RADIAL LAYOUT HELPERS ---

// Build a map from parent node ID to their children node IDs, based on the edges.
function getChildMap(edges: Edge[]) {
  const childMap: Record<string, string[]> = {};
  edges.forEach((e) => {
    if (!childMap[e.source]) childMap[e.source] = [];
    childMap[e.source].push(e.target);
  });
  return childMap;
}

// Recursively assign positions in concentric circles for all descendants.
function assignRadialPositions(
  nodes: Node[],
  edges: Edge[],
  rootId: string,
  center: { x: number; y: number },
  layerRadius: number = 180,
  angleStart: number = 0,
  angleEnd: number = 2 * Math.PI,
  layer: number = 1,
  parentCount: number = 1
) {
  const childMap = getChildMap(edges);
  const idToNode: Record<string, Node> = Object.fromEntries(nodes.map((n) => [n.id, n]));

  function placeSubtree(
    id: string,
    center: { x: number; y: number },
    radius: number,
    aStart: number,
    aEnd: number,
    layer: number,
    siblings: number
  ) {
    const children = childMap[id] || [];
    const angleSpan = aEnd - aStart;
    children.forEach((childId, idx) => {
      const angle = aStart + (angleSpan * (idx + 1)) / (children.length + 1);
      idToNode[childId].position = {
        x: center.x + radius * layer * Math.cos(angle),
        y: center.y + radius * layer * Math.sin(angle),
      };
      // Recursively place this child's children
      placeSubtree(
        childId,
        idToNode[childId].position,
        radius,
        angle - angleSpan / (2 * (children.length || 1)),
        angle + angleSpan / (2 * (children.length || 1)),
        layer + 1,
        children.length
      );
    });
  }

  // Place the root node at the center
  if (idToNode[rootId]) {
    idToNode[rootId].position = { ...center };
    placeSubtree(rootId, center, layerRadius, angleStart, angleEnd, layer, parentCount);
  }
  // Any unconnected nodes keep their positions (or can be scattered)
  return Object.values(idToNode);
}

// --------------------
const MindMap: React.FC<MindMapProps> = ({ userQuery, triggerUpdate }) => {
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const { queryGPT, loading } = useGPT();

  // Reference to current mind map state for context
  const mindMapContextRef = useRef<{ nodes: Node[]; edges: Edge[] }>({ nodes: [], edges: [] });

  // Click-to-expand for any node
  const onNodeClick = useCallback(
    async (event, node) => {
      mindMapContextRef.current = { nodes, edges };
      // Pass the clicked node's id as selectedNodeId
      const gptData = await queryGPT(node.data.label || node.id, mindMapContextRef.current, node.id);
      if (gptData && gptData.nodes && gptData.edges) {
        let { nodes: newNodes, edges: newEdges } = transformGPTToFlow(gptData, nodes, edges);
        const mainNodeId = newNodes[0]?.id || "main";
        newNodes = assignRadialPositions(newNodes, newEdges, mainNodeId, { x: centerX, y: centerY });
        setNodes(newNodes);
        setEdges(newEdges);
      }
    },
    [nodes, edges, queryGPT]
  );

  // On user query or trigger, update mind map using GPT
  useEffect(() => {
    const updateMindMap = async () => {
      if (!userQuery) return;
      mindMapContextRef.current = { nodes, edges };
      // On first time, pass selectedNodeId=null; otherwise undefined
      const isFirstTime = !nodes.length && !edges.length;
      const gptData = await queryGPT(
        userQuery,
        mindMapContextRef.current,
        isFirstTime ? null : undefined
      );
      if (gptData && gptData.nodes && gptData.edges) {
        let { nodes: newNodes, edges: newEdges } = transformGPTToFlow(gptData, nodes, edges);
        const mainNodeId = newNodes[0]?.id || "main";
        newNodes = assignRadialPositions(newNodes, newEdges, mainNodeId, { x: centerX, y: centerY });
        setNodes(newNodes);
        setEdges(newEdges);
      }
    };
    updateMindMap();
    // eslint-disable-next-line
  }, [triggerUpdate, userQuery]);

  // Allow user to manually connect nodes (drag edge)
  const onConnect = useCallback(
    (params: Edge | Connection) => setEdges((eds) => addEdge(params, eds)),
    [setEdges]
  );

  return (
    <div style={{ flex: 1, height: "100vh" }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onNodeClick={onNodeClick}
        fitView
        fitViewOptions={fitViewOptions}
        attributionPosition="bottom-right"
      >
        <MiniMap />
        <Controls />
        <Background />
      </ReactFlow>
      <Legend />
      {loading && (
        <div style={{
          position: "absolute", top: 20, right: 20, background: "#fffbe8", padding: 16, borderRadius: 8,
          boxShadow: "0 2px 8px rgba(0,0,0,0.10)", fontWeight: "bold"
        }}>
          Querying AI...
        </div>
      )}
    </div>
  );
};

export default MindMap;
