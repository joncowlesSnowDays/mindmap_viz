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
const startX = 400;    // Center X of map
const startY = 40;     // Top Y of map
const xGap = 40;      // Horizontal gap between siblings (min)
const yGap = 100;      // Vertical gap between layers
const staggerY = 38;   // Vertical stagger within sibling group

// --- Helper Functions ---
function getChildMap(edges: Edge[]) {
  const childMap: Record<string, string[]> = {};
  edges.forEach((e) => {
    if (!childMap[e.source]) childMap[e.source] = [];
    childMap[e.source].push(e.target);
  });
  return childMap;
}

// --- Staggered Tree Layout ---
function assignStaggeredTreePositions(
  nodes: Node[],
  edges: Edge[],
  rootId: string,
  startX: number = 400,
  startY: number = 40,
  xGap: number = 110,
  yGap: number = 120,
  staggerY: number = 36 // how much to fan out vertically per child index
) {
  const childMap = getChildMap(edges);
  const idToNode: Record<string, Node> = Object.fromEntries(nodes.map(n => [n.id, n]));

  function labelWidth(id: string): number {
    const label = idToNode[id]?.data?.label || '';
    return Math.max(80, label.length * 7 + 32);
  }

  function placeSubtree(id: string, depth: number, x: number, y: number) {
    const children = childMap[id] || [];
    const myWidth = labelWidth(id);
    idToNode[id].position = { x, y };
    if (!children.length) return;

    // Total required width for all children (based on label width + xGap)
    const totalWidth = children.reduce((sum, c) => sum + labelWidth(c), 0) + xGap * (children.length - 1);
    let left = x - totalWidth / 2 + labelWidth(children[0]) / 2;

    // Center index for fan-out calculation
    const mid = Math.floor(children.length / 2);
    children.forEach((childId, i) => {
      // Fan out children *above and below* the parent
      let dy = 0;
      if (children.length % 2 === 1) {
        // Odd: perfectly center
        dy = (i - mid) * staggerY;
      } else {
        // Even: offset a bit more for the two middle children
        if (i < mid) dy = (i - mid) * staggerY - staggerY / 2;
        else dy = (i - mid) * staggerY + staggerY / 2;
      }
      const lx = left + labelWidth(childId) / 2;
      placeSubtree(childId, depth + 1, lx, y + yGap + dy);
      left += labelWidth(childId) + xGap;
    });
  }

  if (idToNode[rootId]) {
    placeSubtree(rootId, 0, startX, startY);
  }
  return Object.values(idToNode);
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
        let positionedNodes = assignStaggeredTreePositions(
          baseNodes, baseEdges, mainNodeId, startX, startY, xGap, yGap, staggerY
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
    // 👇 Only update on triggerUpdate!
  }, [triggerUpdate]);

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
        let positionedNodes = assignStaggeredTreePositions(
          merged.nodes, merged.edges, mainNodeId, startX, startY, xGap, yGap, staggerY
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

  // -------- AUTOMATION LOGIC --------
  useEffect(() => {
    if (!automateSignal || nodes.length === 0) return;

    let cancelled = false;
    const expandRandomNodes = async () => {
      let localExpanded = { ...expandedCache.current };
      let localNodes = [...nodes], localEdges = [...edges];
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
          let positionedNodes = assignStaggeredTreePositions(
            merged.nodes, merged.edges, mainNodeId, startX, startY, xGap, yGap, staggerY
          );
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
