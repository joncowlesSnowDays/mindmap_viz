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
} from "reactflow";
import "reactflow/dist/style.css";
import { useGPT } from "../hooks/useGPT.ts";
import { transformGPTToFlow, mergeExpandedNodesAndEdges } from "../utils/mindMapTransform.ts";
import Legend from "./Legend.tsx";

interface MindMapProps {
  userQuery: string;
  triggerUpdate: number;
  automateCount?: number;
  automateSignal?: number;
}

const fitViewOptions = { padding: 0.18, includeHiddenNodes: true };
const centerX = 400;
const centerY = 300;
const layerRadius = 85; // Tighter layout

// --- Helper Functions ---
function getChildMap(edges: Edge[]) {
  const childMap: Record<string, string[]> = {};
  edges.forEach((e) => {
    if (!childMap[e.source]) childMap[e.source] = [];
    childMap[e.source].push(e.target);
  });
  return childMap;
}

// --- Main Radial Layout with jitter ---
function assignRadialPositions(
  nodes: Node[], edges: Edge[], rootId: string, center: { x: number; y: number },
  layerRadius: number = 85, layer: number = 1
) {
  const childMap = getChildMap(edges);
  const idToNode: Record<string, Node> = Object.fromEntries(nodes.map((n) => [n.id, n]));
  function placeChildren(parentId: string, parentPos: { x: number; y: number }, currLayer: number) {
    const children = childMap[parentId] || [];
    if (!children.length) return;
    const angleInc = (2 * Math.PI) / children.length;
    const radius = layerRadius * currLayer;

    children.forEach((childId, idx) => {
      // Moderate JITTER
      const angle = idx * angleInc + (Math.random() - 0.5) * 0.24; // Larger jitter!
      idToNode[childId].position = {
        x: parentPos.x + radius * Math.cos(angle),
        y: parentPos.y + radius * Math.sin(angle),
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

// --- Avoid Node Overlap (simple post-processing) ---
function avoidNodeOverlap(nodes: Node[], minDist = 90, maxIters = 12) {
  let updatedNodes = nodes.map(n => ({ ...n, position: { ...n.position } }));

  for (let iter = 0; iter < maxIters; ++iter) {
    let moved = false;
    for (let i = 0; i < updatedNodes.length; i++) {
      for (let j = i + 1; j < updatedNodes.length; j++) {
        const a = updatedNodes[i].position;
        const b = updatedNodes[j].position;
        const dx = a.x - b.x, dy = a.y - b.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < minDist) {
          moved = true;
          const move = (minDist - dist) / 2 + 1;
          const angle = Math.atan2(dy, dx) || (Math.random() * 2 * Math.PI);
          updatedNodes[i].position.x += Math.cos(angle) * move;
          updatedNodes[i].position.y += Math.sin(angle) * move;
          updatedNodes[j].position.x -= Math.cos(angle) * move;
          updatedNodes[j].position.y -= Math.sin(angle) * move;
        }
      }
    }
    if (!moved) break; // Early exit if nothing moved
  }
  return updatedNodes;
}

// -------- Main Component --------
const MindMap: React.FC<MindMapProps> = ({
  userQuery, triggerUpdate, automateCount = 3, automateSignal = 0,
}) => {
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const { queryGPT, loading } = useGPT();
  const [reactFlowInstance, setReactFlowInstance] = useState<any>(null);
  const expandedCache = useRef<Record<string, boolean>>({});
  const mindMapContextRef = useRef<{ nodes: Node[]; edges: Edge[] }>({ nodes: [], edges: [] });

  // --- Initial Mind Map
  useEffect(() => {
    const updateMindMap = async () => {
      if (!userQuery) return;
      expandedCache.current = {};
      mindMapContextRef.current = { nodes: [], edges: [] };
      const gptData = await queryGPT(userQuery, mindMapContextRef.current, null);
      if (gptData && gptData.nodes && gptData.edges) {
        const { nodes: baseNodes, edges: baseEdges } = transformGPTToFlow(gptData);
        const mainNodeId = baseNodes[0]?.id || "main";
        let positionedNodes = assignRadialPositions(
          baseNodes, baseEdges, mainNodeId, { x: centerX, y: centerY }, layerRadius
        );
        positionedNodes = avoidNodeOverlap(positionedNodes, 90);
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

  // --- Node click expand
  const onNodeClick = useCallback(
    async (_event, node) => {
      if (expandedCache.current[node.id]) return;
      expandedCache.current[node.id] = true;
      mindMapContextRef.current = { nodes, edges };
      const gptData = await queryGPT(node.data.label || node.id, mindMapContextRef.current, node.id);
      if (gptData && gptData.nodes && gptData.edges) {
        const { nodes: newNodes, edges: newEdges } = transformGPTToFlow(gptData);
        const merged = mergeExpandedNodesAndEdges(nodes, edges, newNodes, newEdges, node.id);
        const mainNodeId = nodes[0]?.id || "main";
        let positionedNodes = assignRadialPositions(
          merged.nodes, merged.edges, mainNodeId, { x: centerX, y: centerY }, layerRadius
        );
        positionedNodes = avoidNodeOverlap(positionedNodes, 90);
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

  // -------- AUTOMATION LOGIC --------
  useEffect(() => {
    if (!automateSignal || nodes.length === 0) return;

    let cancelled = false;
    const expandRandomNodes = async () => {
      let localExpanded = { ...expandedCache.current };
      let localNodes = [...nodes], localEdges = [...edges];

      // Get all *expandable* nodes (not already expanded)
      let expandable = () => localNodes.filter(n => !localExpanded[n.id]);
      let count = Math.min(automateCount, expandable().length);

      for (let i = 0; i < count; ++i) {
        let candidates = expandable();
        if (candidates.length === 0 || cancelled) break;
        let picked = candidates[Math.floor(Math.random() * candidates.length)];
        localExpanded[picked.id] = true;
        mindMapContextRef.current = { nodes: localNodes, edges: localEdges };
        const gptData = await queryGPT(
          picked.data.label || picked.id,
          mindMapContextRef.current,
          picked.id
        );
        if (gptData && gptData.nodes && gptData.edges) {
          const { nodes: newNodes, edges: newEdges } = transformGPTToFlow(gptData);
          const merged = mergeExpandedNodesAndEdges(localNodes, localEdges, newNodes, newEdges, picked.id);
          const mainNodeId = merged.nodes[0]?.id || "main";
          let positionedNodes = assignRadialPositions(
            merged.nodes, merged.edges, mainNodeId, { x: centerX, y: centerY }, layerRadius
          );
          positionedNodes = avoidNodeOverlap(positionedNodes, 90);
          localNodes = positionedNodes;
          localEdges = merged.edges;
          setNodes(positionedNodes);
          setEdges(merged.edges);
          mindMapContextRef.current = { nodes: positionedNodes, edges: merged.edges };
          if (reactFlowInstance) {
            setTimeout(() => reactFlowInstance.fitView(fitViewOptions), 100);
          }
        }
        await new Promise(res => setTimeout(res, 350));
      }
    };
    expandRandomNodes();
    return () => { cancelled = true; };
    // eslint-disable-next-line
  }, [automateSignal]);

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
