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
  NodePositionChange,
  applyNodeChanges,
} from "reactflow";
import "reactflow/dist/style.css";
import { useGPT } from "../hooks/useGPT.ts";
import { transformGPTToFlow, mergeExpandedNodesAndEdges } from "../utils/mindMapTransform.ts";
import Legend from "./Legend.tsx";
import MindMapNode from "./mindMapNode.tsx";
import InfoModal from "./InfoModal.tsx";

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
const minNodeHeight = 26; // Reduced from 32 to 26 for more compact nodes

// --- Node size estimation ---
function estimateNodeWidth(label: string): number {
  return Math.max(80, label.length * 8.5 + minNodePadding * 2 + 24);
}
function estimateNodeHeight(): number {
  return Math.max(minNodeHeight, 30); 
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

// --- Space Finding Utilities ---
function findOpenSpace(
  existingNodes: Node[],
  parentNode: Node,
  nodeWidth: number,
  nodeHeight: number,
  staggerOffset: number,
  childIndex: number,
  siblingCount: number
): { x: number; y: number } {
  // Convert existing nodes to bounding boxes for collision checks
  const boxes = existingNodes.map(n => ({
    x: n.position.x - estimateNodeWidth(n.data?.label || "") / 2,
    y: n.position.y - nodeHeight / 2,
    width: estimateNodeWidth(n.data?.label || ""),
    height: nodeHeight,
    id: n.id
  }));

  // Calculate base position with improved stagger
  const sign = (childIndex % 2 === 0) ? 1 : -1;
  const offsetIdx = Math.floor((childIndex + 1) / 2);
  const baseStaggerY = sign * offsetIdx * (staggerY * 0.8); // Reduced stagger

  // Start from parent's position with dynamic gap
  const baseX = parentNode.position.x;
  const dynamicYGap = Math.max(yGap, nodeHeight * 1.5);
  const baseY = parentNode.position.y + dynamicYGap;
  const parentBoundary = parentNode.position.y + nodeHeight;
  
  // Calculate initial spread with density awareness
  const totalWidth = siblingCount * (nodeWidth + xGap * 1.2);
  const initialSpread = (childIndex - (siblingCount - 1) / 2) * (nodeWidth + xGap);
  const proposedX = baseX + initialSpread;

  // Calculate node density in different regions
  const regions = {
    left: 0,
    right: 0,
    top: 0,
    bottom: 0
  };

  boxes.forEach(box => {
    const dx = box.x - baseX;
    const dy = box.y - baseY;
    if (dx < 0) regions.left++;
    if (dx > 0) regions.right++;
    if (dy < 0) regions.top++;
    if (dy > 0) regions.bottom++;
  });

  // Adjust search based on density
  const densityOffset = {
    x: regions.right > regions.left ? -nodeWidth * 2 : nodeWidth * 2,
    y: regions.bottom > regions.top ? -nodeHeight * 3 : nodeHeight * 3
  };

  // Define search grid with adaptive parameters
  const maxAttempts = 12; // Increased from 8
  const baseRadius = Math.max(nodeHeight * 3, nodeWidth * 2);
  const positions: Array<{x: number, y: number, score: number}> = [];

  // Enhanced spiral search with density awareness
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const radius = attempt * (baseRadius / maxAttempts);
    const angleStep = Math.PI / 6; // More granular angles
    
    for (let angle = 0; angle < Math.PI * 2; angle += angleStep) {
      // Apply density-based offsets to the search pattern
      const xOffset = Math.cos(angle) * radius + (attempt * densityOffset.x / maxAttempts);
      const yOffset = Math.abs(Math.sin(angle) * radius) + (attempt * densityOffset.y / maxAttempts);
      const proposedY = baseY + baseStaggerY + yOffset;

      // Ensure minimum parent-child separation
      if (proposedY <= parentNode.position.y + nodeHeight + minNodeHeight/2) continue;

      // Position candidate
      const proposed = {
        x: proposedX + xOffset - nodeWidth / 2,
        y: proposedY - nodeHeight / 2,
        width: nodeWidth,
        height: nodeHeight
      };

      // Check for collisions with minimum spacing
      const hasCollision = boxes.some(box => {
        const spacing = box.id === parentNode.id ? nodeHeight : minNodePadding;
        return checkCollisionWithSpacing(proposed, box, spacing);
      });

      if (!hasCollision) {
        // Enhanced scoring system
        const distanceFromIdeal = Math.sqrt(
          Math.pow(xOffset, 2) + Math.pow(yOffset - baseStaggerY, 2)
        );
        
        // Directional penalties based on density
        const directionalPenalty = 
          (xOffset > 0 ? regions.right : regions.left) * 0.2 +
          (yOffset > 0 ? regions.bottom : regions.top) * 0.3;
        
        // Score components
        const verticalScore = Math.abs(proposedY - (baseY + baseStaggerY));
        const horizontalScore = Math.abs(xOffset);
        const densityScore = directionalPenalty * distanceFromIdeal;
        
        // Calculate minimum distances to all other nodes
        const minDistance = Math.min(...boxes.map(box => 
          Math.sqrt(
            Math.pow((proposedX + xOffset) - (box.x + box.width/2), 2) +
            Math.pow(proposedY - (box.y + box.height/2), 2)
          )
        ));
        
        const spacingBonus = Math.log(minDistance + 1) * 2;

        positions.push({
          x: proposedX + xOffset,
          y: proposedY,
          score: distanceFromIdeal * 0.3 + 
                 verticalScore * 0.4 + 
                 horizontalScore * 0.5 + 
                 densityScore -
                 spacingBonus // Lower score is better, so subtract spacing bonus
        });
      }
    }

    // Early exit if we found good positions
    if (positions.length >= 3) break;
  }

  // Pick the best position considering multiple factors
  if (positions.length > 0) {
    const best = positions.reduce((a, b) => a.score < b.score ? a : b);
    return { x: best.x, y: best.y };
  }

  // Fallback with increased vertical offset if no space found
  return { 
    x: proposedX,
    y: baseY + baseStaggerY + nodeHeight * 2
  };
}

function checkCollisionWithSpacing(a: any, b: any, spacing: number = minNodePadding) {
  return !(
    a.x + a.width + spacing < b.x ||
    b.x + b.width + spacing < a.x ||
    a.y + a.height + spacing < b.y ||
    b.y + b.height + spacing < a.y
  );
}

// --- Staggered Tree with manual position override and space finding ---
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

    // Get the actual parent node position (could be manual or calculated)
    const parentPos = idToNode[id].position;
    const parentBottom = parentPos.y + minNodeHeight/2;

    const totalChildrenWidth =
      children.reduce((sum, cid) => sum + nodeWidth(cid), 0) +
      xGap * (children.length - 1);

    let left = x - totalChildrenWidth / 2 + nodeWidth(children[0]) / 2;
    
    // Place children with smart space finding
    children.forEach((childId, i) => {
      if (userPositions[childId]) {
        placeSubtree(childId, depth + 1, userPositions[childId].x, userPositions[childId].y);
        return;
      }

      const childX = left + nodeWidth(childId) / 2;
      const existingNodes = Object.values(idToNode).filter(n => 
        n.id !== childId && !children.includes(n.id)
      );

      const position = findOpenSpace(
        existingNodes,
        idToNode[id],
        nodeWidth(childId),
        minNodeHeight,
        staggerY,
        i,
        children.length
      );

      // Ensure the child stays below parent
      const adjustedY = Math.max(position.y, parentBottom + minNodeHeight/2);
      
      placeSubtree(childId, depth + 1, position.x, adjustedY);
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
  maxIters = 32 // Increased iterations for better resolution
) {
  // Sort nodes by their vertical position to help with top-down layout
  nodes.sort((a, b) => a.position.y - b.position.y);
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
  const [nodes, setNodes] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const { queryGPT, queryNodeInfo, loading, infoLoading } = useGPT();
  
  // Modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [modalContent, setModalContent] = useState("");
  const [modalTitle, setModalTitle] = useState("");
  const [reactFlowInstance, setReactFlowInstance] = useState<any>(null);
  const expandedCache = useRef<Record<string, boolean>>({});
  const mindMapContextRef = useRef<{ nodes: Node[]; edges: Edge[] }>({ nodes: [], edges: [] });
  const userPositionsRef = useRef<Record<string, {x: number, y: number}>>({});

  // Handle ALL node position changes including dragging
  const onNodesChange = useCallback<OnNodesChange>(
    (changes: NodeChange[]) => {
      setNodes((nds) => {
        const newNodes = applyNodeChanges(changes, nds);
        
        // Handle position changes (dragging)
        const positionChanges = changes.filter(
          (change): change is NodePositionChange => (
            change.type === 'position' && 
            'position' in change && 
            'dragging' in change &&
            change.dragging === true
          )
        );
        
        if (positionChanges.length > 0) {
          // For each moved node, calculate the delta and apply to its children
          const childMap = getChildMap(edges);
          const deltas = new Map<string, { dx: number; dy: number }>();
          
          // First pass: calculate position deltas for moved nodes
          positionChanges.forEach(change => {
            const oldNode = nds.find(n => n.id === change.id);
            if (oldNode && change.position) {
              deltas.set(change.id, {
                dx: change.position.x - oldNode.position.x,
                dy: change.position.y - oldNode.position.y
              });
              // Store user-defined position
              userPositionsRef.current[change.id] = change.position;
            }
          });
          
          // Second pass: apply deltas to descendants
          const updatedNodes = newNodes.map(node => {
            // Find the nearest dragged ancestor
            let current = node.id;
            let deltaToApply: { dx: number; dy: number } | undefined;
            
            while (current) {
              const delta = deltas.get(current);
              if (delta) {
                deltaToApply = delta;
                break;
              }
              // Move up to parent
              const parent = edges.find(e => e.target === current)?.source;
              if (!parent) break;
              current = parent;
            }
            
            // Apply ancestor's movement to this node
            if (deltaToApply) {
              const newPos = {
                x: node.position.x + deltaToApply.dx,
                y: node.position.y + deltaToApply.dy
              };
              userPositionsRef.current[node.id] = newPos;
              return { ...node, position: newPos };
            }
            return node;
          });
          
          return updatedNodes;
        }
        
        return newNodes;
      });
    },
    [edges]
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

  // Handle expand/collapse click
  const handleExpandClick = useCallback(async (nodeId: string) => {
    const node = nodes.find(n => n.id === nodeId);
    if (!node) return;

    const childMap = getChildMap(edges);
    const hasChildren = childMap[nodeId]?.length > 0;
    const isExpanded = node.data.isExpanded;

    if (hasChildren) {
      // Toggle visibility of children
      const descendantIds = getDescendantIds(nodeId, childMap);
      setNodes(nodes => 
        nodes.map(n => ({
          ...n,
          hidden: descendantIds.includes(n.id) ? isExpanded : n.hidden,
          data: {
            ...n.data,
            isExpanded: n.id === nodeId ? !isExpanded : n.data.isExpanded
          }
        }))
      );
    } else {
      // Load new children
      mindMapContextRef.current = { nodes, edges };
      const gptData = await queryGPT(node.data.label || node.id, mindMapContextRef.current, nodeId);
      
      if (gptData && gptData.nodes && gptData.edges) {
        // Mark new nodes with isNew flag for animation
        const newNodes = gptData.nodes.map(n => ({ ...n, isNew: true }));
        const { nodes: flowNodes, edges: flowEdges } = transformGPTToFlow({ 
          nodes: newNodes, 
          edges: gptData.edges 
        });

        const merged = mergeExpandedNodesAndEdges(nodes, edges, flowNodes, flowEdges, nodeId);
        const mainNodeId = nodes[0]?.id || "main";

        // Update node positions
        let positionedNodes = assignStaggeredTreePositions(
          merged.nodes, 
          merged.edges, 
          mainNodeId, 
          startX, 
          startY, 
          xGap, 
          yGap, 
          staggerY, 
          userPositionsRef.current
        );

        // Resolve overlaps
        positionedNodes = resolveNodeOverlapsBoundingBox(positionedNodes, minNodePadding, 32);

        // Update state
        setNodes(positionedNodes);
        setEdges(merged.edges);
        mindMapContextRef.current = { nodes: positionedNodes, edges: merged.edges };

        // Fit view after layout
        if (reactFlowInstance) {
          setTimeout(() => reactFlowInstance.fitView(fitViewOptions), 100);
        }
      }
    }
  }, [nodes, edges, queryGPT, reactFlowInstance]);

  // --- AUTOMATION LOGIC ---
  useEffect(() => {
    if (!automateSignal || nodes.length === 0) return;

    let cancelled = false;
    const expandRandomNodes = async () => {
      let localExpanded = { ...expandedCache.current };
      let localNodes = [...nodes], localEdges = [...edges];
      let expandable = () => localNodes.filter(n => !localExpanded[n.id] && n.data?.preview);
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

  // Handle info button click
  const handleInfoClick = useCallback(async (nodeId: string) => {
    const node = nodes.find(n => n.id === nodeId);
    if (!node) return;

    setModalTitle(node.data.label);
    setModalOpen(true);
    setModalContent(""); // Reset content while loading
    
    // Get child labels if any
    const childIds = edges
      .filter(e => e.source === nodeId)
      .map(e => e.target);
    const childLabels = childIds
      .map(id => nodes.find(n => n.id === id)?.data.label)
      .filter(Boolean) as string[];

    try {
      const info = await queryNodeInfo(nodeId, node.data.label, childLabels);
      if (info) {
        setModalContent(info);
      } else {
        setModalContent("Failed to load information for this node.");
      }
    } catch (error) {
      console.error("Error loading node info:", error);
      setModalContent("An error occurred while loading information.");
    }
  }, [nodes, edges, queryNodeInfo]);

  return (
    <div style={{ flex: 1, height: "100vh" }}>
      <ReactFlow
        nodes={nodes.map(node => ({
          ...node,
          data: {
            ...node.data,
            label: node.data.label,
            onInfoClick: handleInfoClick,
            onExpandClick: handleExpandClick,
            hasChildren: getChildMap(edges)[node.id]?.length > 0,
            isExpanded: node.data.isExpanded,
            isRoot: node.id === nodes[0]?.id
          }
        }))}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        fitView
        fitViewOptions={fitViewOptions}
        attributionPosition="bottom-right"
        onInit={setReactFlowInstance}
        nodeTypes={nodeTypes}
        defaultEdgeOptions={{
          type: 'smoothstep',
          animated: false,
          style: { strokeWidth: 1.5 }
        }}
        snapToGrid={false}
        selectNodesOnDrag={false}
        minZoom={0.1}
        maxZoom={2}
        nodesDraggable={true}
        nodesConnectable={false}
      >
        <MiniMap 
          nodeStrokeColor="#aaa"
          nodeColor="#fff"
          nodeBorderRadius={8}
        />
        <Controls showInteractive={false} />
        <Background color="#aaa" gap={32} />
      </ReactFlow>
      <Legend />
      <InfoModal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        title={modalTitle}
        content={modalContent}
        loading={infoLoading}
      />
      {loading && (
        <div style={{
          position: "absolute",
          top: 20,
          right: 20,
          background: "#fffbe8",
          padding: "12px 20px",
          borderRadius: 8,
          boxShadow: "0 2px 8px rgba(0,0,0,0.12)",
          fontWeight: 500,
          fontSize: 14,
          color: "#333",
          display: "flex",
          alignItems: "center",
          gap: 8,
          zIndex: 1000
        }}>
          <div style={{ width: 16, height: 16, border: "3px solid #7c3aed", borderRightColor: "transparent", borderRadius: "50%", animation: "spin 1s linear infinite" }} />
          Querying AI...
        </div>
      )}
    </div>
  );
};

export default MindMap;
