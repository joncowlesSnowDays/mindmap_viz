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
import { 
  transformGPTToFlow, 
  mergeExpandedNodesAndEdges,
  preserveExistingPositions,
  getChildMap,
  getDescendantIds
} from "../utils/mindMapTransform.ts";
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
const minNodeHeight = 26;

// --- Node size estimation ---
function estimateNodeWidth(label: string): number {
  return Math.max(80, label.length * 8.5 + minNodePadding * 2 + 24);
}
function estimateNodeHeight(): number {
  return Math.max(minNodeHeight, 30); 
}

// --- Bulk Space Finding for Groups ---
function findBulkSpace(
  existingNodes: Node[],
  parentNode: Node,
  childrenData: Array<{id: string, width: number, height: number}>,
  minGap: number = minNodePadding
): { x: number; y: number; width: number; height: number } {
  // Calculate total dimensions needed for all children
  const totalWidth = childrenData.reduce((sum, child) => sum + child.width, 0) + 
                    xGap * (childrenData.length - 1);
  const maxHeight = Math.max(...childrenData.map(child => child.height));
  
  // Convert existing nodes to bounding boxes for collision checks
  const boxes = existingNodes.map(n => ({
    x: n.position.x - estimateNodeWidth(n.data?.label || "") / 2,
    y: n.position.y - estimateNodeHeight() / 2,
    width: estimateNodeWidth(n.data?.label || ""),
    height: estimateNodeHeight(),
    id: n.id
  }));

  // Start search from parent position
  const baseX = parentNode.position.x;
  const dynamicYGap = Math.max(yGap, maxHeight * 1.5);
  const baseY = parentNode.position.y + dynamicYGap;
  
  // Define search parameters for bulk area
  const searchRegions = [
    // Centered below parent (preferred)
    { x: baseX - totalWidth / 2, y: baseY, priority: 1 },
    // Left of parent
    { x: baseX - totalWidth - minGap * 2, y: baseY, priority: 2 },
    // Right of parent  
    { x: baseX + minGap * 2, y: baseY, priority: 2 },
    // Further down, centered
    { x: baseX - totalWidth / 2, y: baseY + maxHeight + minGap * 2, priority: 3 },
    // Further down, left
    { x: baseX - totalWidth - minGap * 3, y: baseY + maxHeight + minGap * 2, priority: 3 },
    // Further down, right
    { x: baseX + minGap * 3, y: baseY + maxHeight + minGap * 2, priority: 3 }
  ];

  // Test each search region
  for (const region of searchRegions.sort((a, b) => a.priority - b.priority)) {
    const proposedArea = {
      x: region.x,
      y: region.y,
      width: totalWidth,
      height: maxHeight
    };

    // Check if this area conflicts with any existing nodes
    const hasCollision = boxes.some(box => 
      checkCollisionWithSpacing(proposedArea, box, minGap)
    );

    if (!hasCollision) {
      return proposedArea;
    }
  }

  // Fallback: place far below with extra spacing
  return {
    x: baseX - totalWidth / 2,
    y: baseY + maxHeight * 2 + minGap * 3,
    width: totalWidth,
    height: maxHeight
  };
}

// --- Individual Space Finding (Legacy - for backwards compatibility) ---
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

    // Prepare children data for bulk placement
    const childrenData = children.map(childId => ({
      id: childId,
      width: nodeWidth(childId),
      height: estimateNodeHeight()
    }));

    // Check if any children have manual positions
    const hasManualPositions = children.some(childId => userPositions[childId]);
    
    if (hasManualPositions) {
      // Use legacy individual placement for manually positioned nodes
      const totalChildrenWidth =
        children.reduce((sum, cid) => sum + nodeWidth(cid), 0) +
        xGap * (children.length - 1);

      let left = x - totalChildrenWidth / 2 + nodeWidth(children[0]) / 2;
      
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
    } else {
      // Use new bulk placement strategy for all new nodes
      const existingNodes = Object.values(idToNode).filter(n => 
        !children.includes(n.id) && n.id !== id
      );

      const bulkArea = findBulkSpace(existingNodes, idToNode[id], childrenData);
      
      // Place children within the reserved bulk area
      let currentX = bulkArea.x;
      children.forEach((childId, i) => {
        const childData = childrenData[i];
        const adjustedY = Math.max(bulkArea.y, parentBottom + minNodeHeight/2);
        
        // Center the child horizontally within its allocated width
        const childCenterX = currentX + childData.width / 2;
        
        placeSubtree(childId, depth + 1, childCenterX, adjustedY);
        currentX += childData.width + xGap;
      });
    }
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

  // Cache for dragging state
  const dragCache = useRef<{
    dragging: boolean;
    nodeId: string | null;
    descendants: string[] | null;
  }>({
    dragging: false,
    nodeId: null,
    descendants: null
  });

  // Cache child map to avoid recalculation on every position change
  const childMapRef = useRef<Record<string, string[]>>({});
  
  // Update child map when edges change
  useEffect(() => {
    childMapRef.current = getChildMap(edges);
  }, [edges]);

  // Handle ALL node position changes including dragging
  const onNodesChange = useCallback<OnNodesChange>(
    (changes: NodeChange[]) => {
      setNodes((nds) => {
        // Apply any non-position changes first
        let newNodes = [...nds];
        changes.forEach(change => {
          if (change.type !== 'position') {
            newNodes = applyNodeChanges([change], newNodes);
          }
        });

        // Filter to valid position changes only
        const posChanges = changes.filter((c): c is NodePositionChange => {
          return c.type === 'position' && 'position' in c && c.position !== undefined;
        });

        if (posChanges.length === 0) return newNodes;

        // Process each position change
        posChanges.forEach(change => {
          const node = newNodes.find(n => n.id === change.id);
          if (!node || !change.position) return;

          // Calculate the movement delta
          const dx = change.position.x - node.position.x;
          const dy = change.position.y - node.position.y;

          // Skip if no actual movement
          if (dx === 0 && dy === 0) return;

          // Get all descendants that need to move with this node (use cached childMap)
          const descendants = getDescendantIds(change.id, childMapRef.current);

          // Move the node and all its descendants
          newNodes = newNodes.map(n => {
            if (n.id === change.id || descendants.includes(n.id)) {
              const newPos = {
                x: n.position.x + dx,
                y: n.position.y + dy
              };
              // Store positions immediately during dragging for persistence
              userPositionsRef.current[n.id] = newPos;
              return { ...n, position: newPos };
            }
            return n;
          });
        });

        return newNodes;
      });
    },
    [] // No dependencies needed since we use refs
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
        // Pass true for isNewMindMap since this is a fresh mind map
        const { nodes: baseNodes, edges: baseEdges } = transformGPTToFlow(gptData, true);
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
        
        // First merge to get the complete context
        const merged = mergeExpandedNodesAndEdges(nodes, edges, [], [], nodeId);
        // Add the new nodes to the merged context
        const fullContext = {
          nodes: [...merged.nodes, ...newNodes],
          edges: [...merged.edges, ...gptData.edges]
        };
        
        // Now transform with full context for proper level calculation
        const { nodes: flowNodes, edges: flowEdges } = transformGPTToFlow({ 
          nodes: newNodes, 
          edges: gptData.edges 
        }, false, fullContext.nodes, fullContext.edges);
        
        // Preserve all existing positions using the helper
        const existingPositions = preserveExistingPositions(nodes, edges, userPositionsRef.current, nodeId);

        const finalMerged = mergeExpandedNodesAndEdges(nodes, edges, flowNodes, flowEdges, nodeId);

        // Calculate new layout while preserving positions
        const mainNodeId = nodes[0]?.id || "main";
        let positionedNodes = assignStaggeredTreePositions(
          finalMerged.nodes, 
          finalMerged.edges, 
          mainNodeId, 
          startX, 
          startY, 
          xGap, 
          yGap, 
          staggerY, 
          existingPositions
        );

        // Resolve overlaps only for nodes without user positions
        const nodesToResolve = positionedNodes.filter(n => !existingPositions[n.id]);
        if (nodesToResolve.length > 0) {
          const resolvedNewNodes = resolveNodeOverlapsBoundingBox(nodesToResolve, minNodePadding, 32);
          // Merge back resolved nodes
          positionedNodes = positionedNodes.map(n => 
            existingPositions[n.id] ? n : resolvedNewNodes.find(rn => rn.id === n.id) || n
          );
        }

        // Update state
        setNodes(positionedNodes);
        setEdges(finalMerged.edges);
        mindMapContextRef.current = { nodes: positionedNodes, edges: finalMerged.edges };

        // Update user positions with new layout
        userPositionsRef.current = existingPositions;

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
          // Mark new nodes with isNew flag for animation
          const newNodes = gptData.nodes.map(n => ({ ...n, isNew: true }));
          
          // First get the complete context by temporarily merging
          const tempMerged = mergeExpandedNodesAndEdges(localNodes, localEdges, [], [], picked.id);
          const fullContext = {
            nodes: [...tempMerged.nodes, ...newNodes],
            edges: [...tempMerged.edges, ...gptData.edges]
          };
          
          // Transform with full context for proper level calculation
          const { nodes: flowNodes, edges: flowEdges } = transformGPTToFlow({ 
            nodes: newNodes, 
            edges: gptData.edges 
          }, false, fullContext.nodes, fullContext.edges);

          // Preserve existing node positions and colors, including descendants
          const existingPositions = { ...userPositionsRef.current };
          const descendants = getDescendantIds(picked.id, getChildMap(localEdges));
          
          // Store positions for all existing nodes and their descendants
          localNodes.forEach(n => {
            // Store position for any node that doesn't have a stored position yet
            if (!existingPositions[n.id]) {
              existingPositions[n.id] = { ...n.position };
            }
            
            // If this is a node we're expanding, also store positions of its descendants
            if (n.id === picked.id) {
              descendants.forEach(descId => {
                const desc = localNodes.find(d => d.id === descId);
                if (desc) {
                  existingPositions[descId] = { ...desc.position };
                }
              });
            }
          });

          const merged = mergeExpandedNodesAndEdges(localNodes, localEdges, flowNodes, flowEdges, picked.id);

          // Calculate new layout while preserving positions
          const mainNodeId = merged.nodes[0]?.id || "main";
          let positionedNodes = assignStaggeredTreePositions(
            merged.nodes, 
            merged.edges, 
            mainNodeId, 
            startX, 
            startY, 
            xGap, 
            yGap, 
            staggerY, 
            existingPositions
          );

          // Resolve overlaps only for nodes without user positions
          const nodesToResolve = positionedNodes.filter(n => !existingPositions[n.id]);
          if (nodesToResolve.length > 0) {
            const resolvedNewNodes = resolveNodeOverlapsBoundingBox(nodesToResolve, minNodePadding, 32);
            // Merge back resolved nodes
            positionedNodes = positionedNodes.map(n => 
              existingPositions[n.id] ? n : resolvedNewNodes.find(rn => rn.id === n.id) || n
            );
          }

          // Update user positions with new layout
          userPositionsRef.current = existingPositions;

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
            isRoot: node.id === nodes[0]?.id,
            style: node.style // Pass the style to the node data
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
