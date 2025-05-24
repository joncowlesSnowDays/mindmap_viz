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
function getChildMap(edges: Edge[]) {
  const childMap: Record<string, string[]> = {};
  edges.forEach((e) => {
    if (!childMap[e.source]) childMap[e.source] = [];
    childMap[e.source].push(e.target);
  });
  return childMap;
}

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

// --------------------

const MindMap: React.FC<MindMapProps> = ({ userQuery, triggerUpdate }) => {
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const { queryGPT, loading } = useGPT();
  const [reactFlowInstance, setReactFlowInstance] = useState<any>(null);

  // Reference to current mind map state for context
  const mindMapContextRef = useRef<{ nodes: Node[]; edges: Edge[] }>({ nodes: [], edges: [] });

  // Click-to-expand for any node
  const onNodeClick = useCallback(
    async (event, node) => {
      mindMapContextRef.current = { nodes, edges };
      const gptData = await queryGPT(node.data.label || node.id, mindMapContextRef.current, node.id);

      console.log("GPT DATA (click):", gptData);

      if (gptData && gptData.nodes && gptData.edges) {
        let { nodes: newNodes, edges: newEdges } = transformGPTToFlow(gptData, nodes, edges);
        const mainNodeId = newNodes[0]?.id || "main";
        newNodes = assignRadialPositions(newNodes, newEdges, mainNodeId, { x: centerX, y: centerY });

        console.log("TRANSFORMED NODES (click):", newNodes);
        console.log("TRANSFORMED EDGES (click):", newEdges);

        setNodes(newNodes);
        setEdges(newEdges);

        // FIT VIEW to updated nodes/edges after next tick
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

  // Update mind map on explicit trigger, or reset to blank when userQuery is blank
  useEffect(() => {
    // If userQuery is empty or only whitespace, CLEAR the map
    if (!userQuery || !userQuery.trim()) {
      setNodes([]);
      setEdges([]);
      return;
    }

    // Otherwise, run normal initial topic logic
    const updateMindMap = async () => {
      mindMapContextRef.current = { nodes, edges };
      const isFirstTime = !nodes.length && !edges.length;
      const gptData = await queryGPT(
        userQuery,
        mindMapContextRef.current,
        isFirstTime ? null : undefined
      );

      console.log("GPT DATA (query):", gptData);

      if (gptData && gptData.nodes && gptData.edges) {
        let { nodes: newNodes, edges: newEdges } = transformGPTToFlow(gptData, nodes, edges);
        const mainNodeId = newNodes[0]?.id || "main";
        newNodes = assignRadialPositions(newNodes, newEdges, mainNodeId, { x: centerX, y: centerY });

        console.log("TRANSFORMED NODES (query):", newNodes);
        console.log("TRANSFORMED EDGES (query):", newEdges);

        setNodes(newNodes);
        setEdges(newEdges);

        // FIT VIEW to updated nodes/edges after next tick
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
    // eslint-disable-next-line
  }, [triggerUpdate, userQuery, reactFlowInstance]);

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
        onInit={setReactFlowInstance} // <-- This is critical!
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
