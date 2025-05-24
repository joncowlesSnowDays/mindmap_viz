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

interface MindMapProps {
  userQuery: string;
  triggerUpdate: number;
  automateCount?: number;
  automateSignal?: number;
}

const fitViewOptions = { padding: 0.18, includeHiddenNodes: true };
const startX = 400;     // Center X of map
const startY = 40;      // Top Y of map
const xGap = 20;        // Minimum horizontal spacing between siblings (tune!)
const yGap = 110;       // Vertical spacing between layers (tune!)
const staggerY = 32;    // How much to stagger children up/down
const minNodePadding = 20; // px, padding per side for bounding box estimation
const minNodeHeight = 48;  // px, minimum height of a node

// --- Estimate node box size (width/height) based on label ---
function estimateNodeWidth(label: string): number {
  // Font: 16px, ~8.5px per char + padding, min 80
  return Math.max(80, label.length * 8.5 + minNodePadding * 2);
}
function estimateNodeHeight(): number {
  return minNodeHeight;
}

// --- Helper: Build child map from edges ---
function getChildMap(edges: Edge[]) {
  const childMap: Record<string, string[]> = {};
  edges.forEach((e) => {
    if (!childMap[e.source]) childMap[e.source] = [];
    childMap[e.source].push(e.target);
  });
  return childMap;
}

// --- Get all descendants (recursive) for parent/child drag logic ---
function getDescendantIds(parentId: string, childMap: Record<string, string[]>): string[] {
  const result: string[] = [];
  function traverse(id: string) {
    const children = childMap[id] || [];
    for (const child of children) {
      result.push(child);
      traverse(child);
    }
  }
  traverse(parentId);
  return result;
}

// --- Staggered Tree Layout ---
function assignStaggeredTreePositions(
  nodes: Node[],
  edges: Edge[],
  rootId: string,
  startX: number = 400,
  startY: number = 40,
  xGap: number = 70,
  yGap: number = 120,
  staggerY: number = 32 // Amount to stagger vertically per child index
) {
  const childMap = getChildMap(edges);
  const idToNode: Record<string, Node> = Object.fromEntries(nodes.map(n => [n.id, n]));

  function nodeLabel(id: string): string {
    return idToNode[id]?.data?.label || "";
  }

  function nodeWidth(id: string): number {
    return estimateNodeWidth(nodeLabel(id));
  }
  function nodeHeight(): number {
    return estimateNodeHeight();
  }

  function placeSubtree(id: string, depth: number, x: number, y: number) {
    const children = childMap[id] || [];
    const myWidth = nodeWidth(id);
    idToNode[id].position = { x, y };
    if (!children.length) return;

    // Stagger: Distribute children horizontally & vertically, alternate up/down from center
    const totalChildrenWidth =
      children.reduce((sum, cid) => sum + nodeWidth(cid), 0) +
      xGap * (children.length - 1);

    let left = x - totalChildrenWidth / 2 + nodeWidth(children[0]) / 2;

    const centerIdx = (children.length - 1) / 2;
    children.forEach((childId, i) => {
      // Alternate above/below: (0: center), (1: up), (2: down), (3: up2), (4: down2) etc
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
  minGap = 12,   // Minimum extra gap between boxes
  maxIters = 24  // Number of times to push apart
) {
  // Give each node a bounding box
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
          // Move apart along axis of greatest overlap
          if (xOverlap > yOverlap) {
            const push = (yOverlap - minGap) / 2 + 1;
            boxes[i].position.y -= push;
            boxes[j].position.y += push;
          } else {
            const push = (xOverlap - minGap) / 2 + 1;
            boxes[i].position.x -= push;
            boxes[j].position.x += push;
          }
          // Update bounding box
          boxes[i]._box.x = boxes[i].position.x - a.w / 2;
          boxes[j]._box.x = boxes[j].position.x - b.w / 2;
          boxes[i]._box.y = boxes[i].position.y - a.h / 2;
          boxes[j]._box.y = boxes[j].position.y - b.h / 2;
        }
      }
    }
    if (!moved) break;
  }
  // Remove _box helper
  return boxes.map(({ _box, ...node }) => node);
}

// -------- Main Component --------
const MindMap: React.FC<MindMapProps> = ({
  userQuery, triggerUpdate, automateCount = 3, automateSignal = 0,
}) => {
  const [nodes, setNodes, rawOnNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const { queryGPT, loading } = useGPT();
  const [reactFlowInstance, setReactFlowInstance] = useState<any>(null);
  const expandedCache = useRef<Record<string, boolean>>({});
  const mindMapContextRef = useRef<{ nodes: Node[]; edges: Edge[] }>({ nodes: [], edges: [] });

  // --- Custom onNodesChange for parent/child drag ---
  const onNodesChange = useCallback<OnNodesChange>(
    (changes: NodeChange[]) => {
      let updated = [...nodes];
      const childMap = getChildMap(edges);

      changes.forEach(change => {
        if (change.type === "position" && change.dragging && change.position) {
          // Find all descendants to move
          const descendantIds = getDescendantIds(change.id, childMap);

          // Find delta for moved node (safe for undefined)
          const node = updated.find(n => n.id === change.id);
          const prevX = node?.position?.x ?? 0;
          const prevY = node?.position?.y ?? 0;
          const newX = change.position.x ?? prevX;
          const newY = change.position.y ?? prevY;
          const dx = newX - prevX;
          const dy = newY - prevY;

          updated = updated.map(n => {
            // Move dragged node
            if (n.id === change.id) {
              if (
                change.position &&
                typeof change.position.x === "number" &&
                typeof change.position.y === "number"
              ) {
                return {
                  ...n,
                  position: {
                    x: change.position.x,
                    y: change.position.y,
                  },
                };
              } else {
                return n;
              }
            }
            // Move all descendants by the same delta
            if (descendantIds.includes(n.id)) {
              const cx = n.position?.x ?? 0;
              const cy = n.position?.y ?? 0;
              return {
                ...n,
                position: {
                  x: cx + dx,
                  y: cy + dy,
                },
              };
            }
            return n;
          });
        }
      });
      setNodes(updated);
    },
    [nodes, edges, setNodes]
  );

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
