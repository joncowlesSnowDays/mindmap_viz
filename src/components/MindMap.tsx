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
  MarkerType,
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
  padding: 0.18,
  includeHiddenNodes: true,
};

const centerX = 400;
const centerY = 300;
const layerRadius = 250; // The "default" layer radius

// --- Layout Helpers ---
function getChildMap(edges: Edge[]) {
  const childMap: Record<string, string[]> = {};
  edges.forEach((e) => {
    if (!childMap[e.source]) childMap[e.source] = [];
    childMap[e.source].push(e.target);
  });
  return childMap;
}

/**
 * Recursively position each parent's children in a full circle around it (with large jitter).
 */
function assignRadialPositions(
  nodes: Node[],
  edges: Edge[],
  rootId: string,
  center: { x: number; y: number },
  layerRadius: number = 200,
  layer: number = 1
) {
  const childMap = getChildMap(edges);
  const idToNode: Record<string, Node> = Object.fromEntries(nodes.map((n) => [n.id, n]));

  function placeChildren(parentId: string, parentPos: { x: number; y: number }, currLayer: number) {
    const children = childMap[parentId] || [];
    if (!children.length) return;
    const angleInc = (2 * Math.PI) / children.length;
    const radius = layerRadius * currLayer;

    children.forEach((childId, idx) => {
      // Large jitter for "messier" or more organic layout
      const angleJitter = (Math.random() - 0.5) * 1.2; // up to ±0.6 radians (~34°)
      const radiusJitter = (Math.random() - 0.5) * (layerRadius * 0.6); // up to ±30% of layerRadius
      const angle = idx * angleInc + angleJitter;
      const r = radius + radiusJitter;
      idToNode[childId].position = {
        x: parentPos.x + r * Math.cos(angle),
        y: parentPos.y + r * Math.sin(angle),
      };
      placeChildren(childId, idToNode[childId].position, currLayer + 1);
    });
  }

  if (idToNode[rootId]) {
    idToNode[rootId].position = { ...center };
    placeChildren(rootId, center, 1);
  }
  return Object.values(idToNode);
}

// --- Main MindMap Component ---
const MindMap: React.FC<MindMapProps> = ({ userQuery, triggerUpdate }) => {
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const { queryGPT, loading } = useGPT();
  const [reactFlowInstance, setReactFlowInstance] = useState<any>(null);

  // --- Track expanded nodes to prevent duplicate expansion ---
  const expandedCache = useRef<Record<string, boolean>>({});

  // --- Mind map context cache for expansion ---
  const mindMapContextRef = useRef<{ nodes: Node[]; edges: Edge[] }>({ nodes: [], edges: [] });

  // --- Initial map creation on new query ---
  useEffect(() => {
    const updateMindMap = async () => {
      if (!userQuery) return;
      expandedCache.current = {};
      mindMapContextRef.current = { nodes: [], edges: [] };
      const gptData = await queryGPT(userQuery, mindMapContextRef.current, null);
      if (gptData && gptData.nodes && gptData.edges) {
        const { nodes: baseNodes, edges: baseEdges } = transformGPTToFlow(gptData);
        const mainNodeId = baseNodes[0]?.id || "main";
        const positionedNodes = assignRadialPositions(
          baseNodes,
          baseEdges,
          mainNodeId,
          { x: centerX, y: centerY },
          layerRadius
        );
        setNodes(positionedNodes);
        setEdges(baseEdges);
        mindMapContextRef.current = { nodes: positionedNodes, edges: baseEdges };
        if (reactFlowInstance) {
          setTimeout(() => reactFlowInstance.fitView(fitViewOptions), 100);
        }
      }
    };
    updateMindMap();
    // eslint-disable-next-line
  }, [triggerUpdate, userQuery, reactFlowInstance]);

  // --- Node expansion (expanding a subtopic) ---
  const onNodeClick = useCallback(
    async (_event, node) => {
      if (expandedCache.current[node.id]) return; // Only expand once
      expandedCache.current[node.id] = true;

      mindMapContextRef.current = { nodes, edges };
      const gptData = await queryGPT(node.data.label || node.id, mindMapContextRef.current, node.id);
      if (gptData && gptData.nodes && gptData.edges) {
        const { nodes: newNodes, edges: newEdges } = transformGPTToFlow(gptData);
        // Merge with current map, replacing only children of expanded node
        const merged = mergeExpandedNodesAndEdges(nodes, edges, newNodes, newEdges, node.id);
        const mainNodeId = nodes[0]?.id || "main";
        const positionedNodes = assignRadialPositions(
          merged.nodes, merged.edges, mainNodeId, { x: centerX, y: centerY }, layerRadius
        );
        setNodes(positionedNodes);
        setEdges(merged.edges);
        mindMapContextRef.current = { nodes: positionedNodes, edges: merged.edges };
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
