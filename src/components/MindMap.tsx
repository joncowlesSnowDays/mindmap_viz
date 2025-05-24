import React, { useCallback, useRef, useState } from "react";
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
import { useGPT } from "../hooks/useGPT";
import { transformGPTToFlow } from "../utils/mindMapTransform";
import Legend from "./Legend";

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

// Helper to get direct children for a node
function getChildrenAndEdges(nodeId: string, nodes: Node[], edges: Edge[]) {
  const childrenIds = edges.filter(e => e.source === nodeId).map(e => e.target);
  const children = nodes.filter(n => childrenIds.includes(n.id));
  const childEdges = edges.filter(e => e.source === nodeId);
  return { children, childEdges };
}

// Assign radial positions with jitter
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
  const childMap: Record<string, string[]> = {};
  edges.forEach((e) => {
    if (!childMap[e.source]) childMap[e.source] = [];
    childMap[e.source].push(e.target);
  });
  const idToNode: Record<string, Node> = Object.fromEntries(nodes.map((n) => [n.id, n]));
  function randJitter(val: number) {
    return val + (Math.random() - 0.5) * 32; // jitter up to ±16px
  }
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
        x: randJitter(center.x + radius * layer * Math.cos(angle)),
        y: randJitter(center.y + radius * layer * Math.sin(angle)),
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

const MindMap: React.FC<MindMapProps> = ({ userQuery, triggerUpdate }) => {
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const { queryGPT, loading } = useGPT();
  const [reactFlowInstance, setReactFlowInstance] = useState<any>(null);

  // Partial expansion: only expand selected node
  const onNodeClick = useCallback(
    async (event, node) => {
      // 1. Minimal context: the node and its direct children/edges
      const { children, childEdges } = getChildrenAndEdges(node.id, nodes, edges);
      const minimalContext = {
        nodes: [node, ...children],
        edges: childEdges,
      };
      // 2. Call GPT
      const gptData = await queryGPT(node.data.label || node.id, minimalContext, node.id);

      if (gptData && gptData.nodes && gptData.edges) {
        // 3. Merge only new nodes/edges
        const existingNodeIds = new Set(nodes.map(n => n.id));
        const newNodes = gptData.nodes.filter(n => !existingNodeIds.has(n.id));
        const mergedNodes = [...nodes, ...newNodes];

        const existingEdgeIds = new Set(edges.map(e => e.id));
        const newEdges = gptData.edges.filter(e => !existingEdgeIds.has(e.id));
        const mergedEdges = [...edges, ...newEdges];

        // Layout (optional: reposition subtree or whole tree)
        const mainNodeId = nodes[0]?.id || "main";
        const withPositions = assignRadialPositions(mergedNodes, mergedEdges, mainNodeId, { x: centerX, y: centerY });

        setNodes(withPositions);
        setEdges(mergedEdges);

        if (reactFlowInstance) {
          setTimeout(() => {
            try {
              reactFlowInstance.fitView(fitViewOptions);
            } catch (err) {
              console.warn("fitView error (click):", err);
            }
          }, 100);
        }
      }
    },
    [nodes, edges, queryGPT, reactFlowInstance]
  );

  // Initial query (new root concept)
  React.useEffect(() => {
    const updateMindMap = async () => {
      if (!userQuery) return;
      // Start fresh for a new query
      const gptData = await queryGPT(userQuery, { nodes: [], edges: [] }, null);
      if (gptData && gptData.nodes && gptData.edges) {
        const withPositions = assignRadialPositions(
          gptData.nodes,
          gptData.edges,
          gptData.nodes[0]?.id || "main",
          { x: centerX, y: centerY }
        );
        setNodes(withPositions);
        setEdges(gptData.edges);

        if (reactFlowInstance) {
          setTimeout(() => {
            try {
              reactFlowInstance.fitView(fitViewOptions);
            } catch (err) {
              console.warn("fitView error (query):", err);
            }
          }, 100);
        }
      }
    };
    updateMindMap();
    // Only trigger on initial triggerUpdate (new root query), NOT on every change
    // eslint-disable-next-line
  }, [triggerUpdate, userQuery, reactFlowInstance]);

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
