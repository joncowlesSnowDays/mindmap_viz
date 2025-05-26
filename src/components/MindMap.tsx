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
  OnNodesChange,
  NodeChange,
} from "reactflow";
import "reactflow/dist/style.css";
import { useGPT } from "../hooks/useGPT.ts";
import { transformGPTToFlow, mergeExpandedNodesAndEdges } from "../utils/mindMapTransform.ts";
import Legend from "./Legend.tsx";
import MindMapNode from "./mindMapNode.tsx";

interface MindMapProps {
  userQuery: string;
  triggerUpdate: number;
  automateCount?: number;
  automateSignal?: number;
}

// Layout params (tweak for your designs)
const fitViewOptions = { padding: 0.18, includeHiddenNodes: true };
const startX = 400;
const startY = 40;
const xGap = 20;
const yGap = 110;
const staggerY = 32;
const minNodePadding = 20;
const minNodeHeight = 48;

// --- Node size estimation ---
function estimateNodeWidth(label: string): number {
  return Math.max(80, label.length * 8.5 + minNodePadding * 2);
}
function estimateNodeHeight(): number {
  return minNodeHeight;
}

// --- Child map ---
function getChildMap(edges: Edge[]) {
  const childMap: Record<string, string[]> = {};
  edges.forEach((e) => {
    if (!childMap[e.source]) childMap[e.source] = [];
    childMap[e.source].push(e.target);
  });
  return childMap;
}

// --- Descendant helper ---
function getDescendantIds(nodeId: string, childMap: Record<string, string[]>, acc: string[] = []): string[] {
  const children = childMap[nodeId] || [];
  for (const c of children) {
    acc.push(c);
    getDescendantIds(c, childMap, acc);
  }
  return acc;
}

// --- Staggered Tree with manual position override ---
function assignStaggeredTreePositions(
  nodes: Node[],
  edges: Edge[],
  rootId: string,
  startX: number = 400,
  startY: number = 40,
  xGap: number = 40,
  yGap: number = 120,
  staggerY: number = 32,
  userPositions: Record<string, {x: number, y: number}> = {}
) {
  const childMap = getChildMap(edges);
  const idToNode: Record<string, Node> = Object.fromEntries(nodes.map(n => [n.id, n]));

  function nodeLabel(id: string): string {
    return idToNode[id]?.data?.label || "";
  }
  function nodeWidth(id: string): number {
    return estimateNodeWidth(nodeLabel(id));
  }
  function placeSubtree(id: string, depth: number, x: number, y: number) {
    const children = childMap[id] || [];
    // --- Always honor user-set position if present
    const manual = userPositions[id];
    idToNode[id].position = manual ? { ...manual } : { x, y };
    if (!children.length) return;

    const totalChildrenWidth =
      children.reduce((sum, cid) => sum + nodeWidth(cid), 0) +
      xGap * (children.length - 1);

    let left = x - totalChildrenWidth / 2 + nodeWidth(children[0]) / 2;
    const centerIdx = (children.length - 1) / 2;
    children.forEach((childId, i) => {
      const sign = (i % 2 === 0) ? 1 : -1;
      const offsetIdx = Math.floor((i + 1) / 2);
      const dy = sign * offsetIdx * staggerY;
      const childX = left + nodeWidth(childId) / 2;
      placeSubtree(childId, depth + 1, childX, y + yGap + dy);
      left += nodeWidth(childId) + xGap;
    });
  }

  if (idToNode[rootId]) {
    placeSubtree(rootId, 0, startX, startY);
  }
  return Object.values(idToNode);
}

// --- Overlap Resolver (Bounding Box Collision) ---
function resolveNodeOverlapsBoundingBox(
  nodes: Node[],
  minGap = 12,
  maxIters = 24
) {
  let boxes = nodes.map(n => {
    const label = n.data?.label || "";
    const w = estimateNodeWidth(label);
    const h = estimateNodeHeight();
    return {
      ...n,
      _box: {
        x: n.position.x - w / 2,
        y: n.position.y - h / 2,
        w, h,
        centerX: n.position.x,
        centerY: n.position.y,
      }
    };
  });

  for (let iter = 0; iter < maxIters; ++iter) {
    let moved = false;
    for (let i = 0; i < boxes.length; ++i) {
      for (let j = i + 1; j < boxes.length; ++j) {
        const a = boxes[i]._box, b = boxes[j]._box;
        const xOverlap = Math.max(0, Math.min(a.x + a.w + minGap, b.x + b.w + minGap) - Math.max(a.x, b.x));
        const yOverlap = Math.max(0, Math.min(a.y + a.h + minGap, b.y + b.h + minGap) - Math.max(a.y, b.y));
        if (xOverlap > minGap && yOverlap > minGap) {
          moved = true;
          if (xOverlap > yOverlap) {
            const push = (yOverlap - minGap) / 2 + 1;
            boxes[i].position.y -= push;
            boxes[j].position.y += push;
          } else {
            const push = (xOverlap - minGap) / 2 + 1;
            boxes[i].position.x -= push;
            boxes[j].position.x += push;
          }
          boxes[i]._box.x = boxes[i].position.x - a.w / 2;
          boxes[j]._box.x = boxes[j].position.x - b.w / 2;
          boxes[i]._box.y = boxes[i].position.y - a.h / 2;
          boxes[j]._box.y = boxes[j].position.y - b.h / 2;
        }
      }
    }
    if (!moved) break;
  }
  return boxes.map(({ _box, ...node }) => node);
}

const nodeTypes = { mindMapNode: MindMapNode };

const MindMap: React.FC<MindMapProps> = ({
  userQuery, triggerUpdate, automateCount = 3, automateSignal = 0,
}) => {
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const { queryGPT, loading } = useGPT();
  const [reactFlowInstance, setReactFlowInstance] = useState<any>(null);
  const expandedCache = useRef<Record<string, boolean>>({});
  const mindMapContextRef = useRef<{ nodes: Node[]; edges: Edge[] }>({ nodes: [], edges: [] });
  const userPositionsRef = useRef<Record<string, {x: number, y: number}>>({});

  // Handle descendant movement after node drag
  const onNodeDragStop = useCallback(
    (_event: any, node: Node) => {
      const childMap = getChildMap(edges);
      const descendantIds = getDescendantIds(node.id, childMap);
      
      // Save user-moved position
      userPositionsRef.current[node.id] = node.position;

      // Calculate movement delta
      const prevPos = nodes.find(n => n.id === node.id)?.position;
      if (!prevPos) return;
      
      const dx = node.position.x - prevPos.x;
      const dy = node.position.y - prevPos.y;

      // Move descendants
      setNodes(nds => 
        nds.map(n => {
          if (descendantIds.includes(n.id)) {
            const newPos = {
              x: n.position.x + dx,
              y: n.position.y + dy
            };
            userPositionsRef.current[n.id] = newPos;
            return {
              ...n,
              position: newPos
            };
          }
          return n;
        })
      );
    },
    [nodes, edges, setNodes]
  );

  // --- Initial Mind Map
  useEffect(() => {
    const updateMindMap = async () => {
      if (!userQuery) return;
      expandedCache.current = {};
      mindMapContextRef.current = { nodes: [], edges: [] };
      // Reset user manual positions
      userPositionsRef.current = {};
      const gptData = await queryGPT(userQuery, mindMapContextRef.current, null);
      if (gptData && gptData.nodes && gptData.edges) {
        const { nodes: baseNodes, edges: baseEdges } = transformGPTToFlow(gptData);
        const mainNodeId = baseNodes[0]?.id || "main";
        let positionedNodes = assignStaggeredTreePositions(
          baseNodes, baseEdges, mainNodeId, startX, startY, xGap, yGap, staggerY, userPositionsRef.current
        );
        positionedNodes = resolveNodeOverlapsBoundingBox(positionedNodes, 10, 32);
        setNodes(positionedNodes);
        setEdges(baseEdges);
        mindMapContextRef.current = { nodes: positionedNodes, edges: baseEdges };
        if (reactFlowInstance) {
          setTimeout(() => reactFlowInstance.fitView(fitViewOptions), 100);
        }
      }
    };
    updateMindMap();
    // Only update on triggerUpdate!
    // eslint-disable-next-line
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
          merged.nodes, merged.edges, mainNodeId, startX, startY, xGap, yGap, staggerY, userPositionsRef.current
        );
        positionedNodes = resolveNodeOverlapsBoundingBox(positionedNodes, 10, 32);
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

  // --- AUTOMATION LOGIC ---
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
            merged.nodes, merged.edges, mainNodeId, startX, startY, xGap, yGap, staggerY, userPositionsRef.current
          );
          positionedNodes = resolveNodeOverlapsBoundingBox(positionedNodes, 10, 32);
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
        onNodeDragStop={onNodeDragStop}
        onConnect={onConnect}
        onNodeClick={onNodeClick}
        fitView
        fitViewOptions={fitViewOptions}
        attributionPosition="bottom-right"
        onInit={setReactFlowInstance}
        nodeTypes={nodeTypes}
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
