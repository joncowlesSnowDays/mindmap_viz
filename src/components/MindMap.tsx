import React, { useEffect, useCallback, useRef, useState } from "react";
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
  MarkerType
} from "reactflow";
import "reactflow/dist/style.css";
import { useGPT } from "../hooks/useGPT.ts";
import { transformGPTToFlow, mergeExpandedNodesAndEdges } from "../utils/mindMapTransform.ts";
import Legend from "./Legend.tsx";

interface MindMapProps {
  userQuery: string;
  triggerUpdate: number;
}

const fitViewOptions = {
  padding: 0.18, // Small padding for better centering
  includeHiddenNodes: true,
};

const centerX = 400;
const centerY = 300;
const layerRadius = 120; // Tweak as needed

function getChildMap(edges: Edge[]) {
  const childMap: Record<string, string[]> = {};
  edges.forEach((e) => {
    if (!childMap[e.source]) childMap[e.source] = [];
    childMap[e.source].push(e.target);
  });
  return childMap;
}

// Recursively assign positions in concentric circles for all descendants (with jitter).
function assignRadialPositions(
  nodes: Node[],
  edges: Edge[],
  rootId: string,
  center: { x: number; y: number },
  layerRadius: number = 200,
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
      const jitter = (Math.random() - 0.5) * 45; // small jitter
      idToNode[childId].position = {
        x: center.x + (radius * layer + jitter) * Math.cos(angle),
        y: center.y + (radius * layer + jitter) * Math.sin(angle),
      };
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

  if (idToNode[rootId]) {
    idToNode[rootId].position = { ...center };
    placeSubtree(rootId, center, layerRadius, angleStart, angleEnd, layer, parentCount);
  }
  return Object.values(idToNode);
}

// --- Main MindMap Component ---
const MindMap: React.FC<MindMapProps> = ({ userQuery, triggerUpdate }) => {
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const { queryGPT, loading } = useGPT();
  const [reactFlowInstance, setReactFlowInstance] = useState<any>(null);

  // --- Store last expanded node id to avoid duplicate expansion ---
  const expandedCache = useRef<Record<string, boolean>>({});

  // Store full node/edge tree for expansion
  const mindMapContextRef = useRef<{ nodes: Node[]; edges: Edge[] }>({ nodes: [], edges: [] });

  // --- Initial Mind Map: NEW Query ---
  useEffect(() => {
    const updateMindMap = async () => {
      if (!userQuery) return;
      expandedCache.current = {}; // Reset expansion cache
      mindMapContextRef.current = { nodes: [], edges: [] }; // Reset previous
      const gptData = await queryGPT(userQuery, mindMapContextRef.current, null);
      if (gptData && gptData.nodes && gptData.edges) {
        const { nodes: baseNodes, edges: baseEdges } = transformGPTToFlow(gptData);
        const mainNodeId = baseNodes[0]?.id || "main";
        const positioned = assignRadialPositions(
          baseNodes,
          baseEdges,
          mainNodeId,
          { x: centerX, y: centerY },
          layerRadius
        );
        setNodes(positioned);
        setEdges(baseEdges);
        mindMapContextRef.current = { nodes: positioned, edges: baseEdges };
        if (reactFlowInstance) {
          setTimeout(() => reactFlowInstance.fitView(fitViewOptions), 100);
        }
      }
    };
    updateMindMap();
    // eslint-disable-next-line
  }, [triggerUpdate, userQuery, reactFlowInstance]);

  // --- Node Expansion ---
  const onNodeClick = useCallback(
    async (_event, node) => {
      // Prevent duplicate expansion on same node
      if (expandedCache.current[node.id]) return;
      expandedCache.current[node.id] = true;

      mindMapContextRef.current = { nodes, edges };
      const gptData = await queryGPT(node.data.label || node.id, mindMapContextRef.current, node.id);
      if (gptData && gptData.nodes && gptData.edges) {
        const { nodes: newNodes, edges: newEdges } = transformGPTToFlow(gptData);
        // Merge with current map, replacing only children of expanded node
        const merged = mergeExpandedNodesAndEdges(nodes, edges, newNodes, newEdges, node.id);
        const mainNodeId = nodes[0]?.id || "main";
        const positioned = assignRadialPositions(
          merged.nodes, merged.edges, mainNodeId, { x: centerX, y: centerY }, layerRadius
        );
        setNodes(positioned);
        setEdges(merged.edges);
        mindMapContextRef.current = { nodes: positioned, edges: merged.edges };
        if (reactFlowInstance) {
          setTimeout(() => reactFlowInstance.fitView(fitViewOptions), 100);
        }
      }
    },
    [nodes, edges, queryGPT, reactFlowInstance]
  );

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
        onInit={setReactFlowInstance}
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
