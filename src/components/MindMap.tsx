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
const xGap = 40; // Increased from 20 to prevent sibling overlap
const yGap = 110;
const staggerY = 32;
const minNodePadding = 20;
const minNodeHeight = 26;

// --- Node size estimation ---
function estimateNodeWidth(label: string): number {
  // Add extra buffer for buttons and padding to prevent overlaps
  return Math.max(80, label.length * 8.5 + minNodePadding * 2 + 40); // Increased from 24 to 40
}
function estimateNodeHeight(): number {
  return Math.max(minNodeHeight, 30); 
}

// --- Spatial Grid for Fast Collision Detection ---
interface SpatialGrid {
  cellSize: number;
  grid: Map<string, Set<string>>;
  nodeBounds: Map<string, BoundingBox>;
}

interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
  id: string;
}

function createSpatialGrid(nodes: Node[], cellSize: number = 100): SpatialGrid {
  const grid = new Map<string, Set<string>>();
  const nodeBounds = new Map<string, BoundingBox>();
  
  nodes.forEach(node => {
    const width = estimateNodeWidth(node.data?.label || "");
    const height = estimateNodeHeight();
    const bounds: BoundingBox = {
      x: node.position.x - width / 2,
      y: node.position.y - height / 2,
      width,
      height,
      id: node.id
    };
    
    nodeBounds.set(node.id, bounds);
    
    // Add to grid cells
    const minCellX = Math.floor(bounds.x / cellSize);
    const maxCellX = Math.floor((bounds.x + bounds.width) / cellSize);
    const minCellY = Math.floor(bounds.y / cellSize);
    const maxCellY = Math.floor((bounds.y + bounds.height) / cellSize);
    
    for (let cellX = minCellX; cellX <= maxCellX; cellX++) {
      for (let cellY = minCellY; cellY <= maxCellY; cellY++) {
        const key = `${cellX},${cellY}`;
        if (!grid.has(key)) {
          grid.set(key, new Set());
        }
        grid.get(key)!.add(node.id);
      }
    }
  });
  
  return { cellSize, grid, nodeBounds };
}

function getGridCandidates(spatialGrid: SpatialGrid, area: BoundingBox): string[] {
  const { cellSize, grid } = spatialGrid;
  const candidates = new Set<string>();
  
  const minCellX = Math.floor(area.x / cellSize);
  const maxCellX = Math.floor((area.x + area.width) / cellSize);
  const minCellY = Math.floor(area.y / cellSize);
  const maxCellY = Math.floor((area.y + area.height) / cellSize);
  
  for (let cellX = minCellX; cellX <= maxCellX; cellX++) {
    for (let cellY = minCellY; cellY <= maxCellY; cellY++) {
      const key = `${cellX},${cellY}`;
      const cellNodes = grid.get(key);
      if (cellNodes) {
        cellNodes.forEach(nodeId => candidates.add(nodeId));
      }
    }
  }
  
  return Array.from(candidates);
}

function checkAreaCollision(spatialGrid: SpatialGrid, area: BoundingBox, minGap: number): boolean {
  const candidates = getGridCandidates(spatialGrid, area);
  
  return candidates.some(nodeId => {
    const nodeBounds = spatialGrid.nodeBounds.get(nodeId);
    if (!nodeBounds) return false;
    
    return checkCollisionWithSpacing(area, nodeBounds, minGap);
  });
}

// --- Advanced Bulk Space Finding with Rigorous Collision Detection ---
function findBulkSpace(
  existingNodes: Node[],
  parentNode: Node,
  childrenData: Array<{id: string, width: number, height: number}>,
  minGap: number = minNodePadding
): { x: number; y: number; width: number; height: number } {
  // Calculate total dimensions needed for all children with better spacing
  const totalWidth = childrenData.reduce((sum, child) => sum + child.width, 0) + 
                    xGap * Math.max(0, childrenData.length - 1);
  const maxHeight = Math.max(...childrenData.map(child => child.height));
  
  // Create spatial grid for fast collision detection
  const spatialGrid = createSpatialGrid(existingNodes);
  
  // Start search from parent position
  const baseX = parentNode.position.x;
  const dynamicYGap = Math.max(yGap, maxHeight * 1.5);
  const baseY = parentNode.position.y + dynamicYGap;
  
  // Enhanced search strategy with more comprehensive coverage
  const searchStrategies = [
    // Primary strategy: Radial search around preferred positions
    () => {
      const preferredPositions = [
        { x: baseX - totalWidth / 2, y: baseY, priority: 1 },
        { x: baseX - totalWidth - minGap * 3, y: baseY, priority: 2 },
        { x: baseX + minGap * 3, y: baseY, priority: 2 },
        { x: baseX - totalWidth / 2, y: baseY + maxHeight + minGap * 3, priority: 3 }
      ];
      
      for (const pos of preferredPositions.sort((a, b) => a.priority - b.priority)) {
        const area = { x: pos.x, y: pos.y, width: totalWidth, height: maxHeight, id: 'bulk' };
        if (!checkAreaCollision(spatialGrid, area, minGap)) {
          return area;
        }
      }
      return null;
    },
    
    // Secondary strategy: Spiral search for open space
    () => {
      const maxRadius = 500;
      const stepSize = 30;
      const angleStep = Math.PI / 8;
      
      for (let radius = stepSize; radius <= maxRadius; radius += stepSize) {
        for (let angle = 0; angle < Math.PI * 2; angle += angleStep) {
          const x = baseX + Math.cos(angle) * radius - totalWidth / 2;
          const y = Math.max(baseY, baseY + Math.sin(angle) * radius);
          
          const area = { x, y, width: totalWidth, height: maxHeight, id: 'bulk' };
          if (!checkAreaCollision(spatialGrid, area, minGap)) {
            return area;
          }
        }
      }
      return null;
    },
    
    // Tertiary strategy: Grid-based systematic search
    () => {
      const searchWidth = 800;
      const searchHeight = 600;
      const gridStep = 40;
      
      const startX = baseX - searchWidth / 2;
      const startY = baseY;
      
      const positions: Array<{x: number, y: number, score: number}> = [];
      
      for (let x = startX; x < startX + searchWidth; x += gridStep) {
        for (let y = startY; y < startY + searchHeight; y += gridStep) {
          const area = { x, y, width: totalWidth, height: maxHeight, id: 'bulk' };
          
          if (!checkAreaCollision(spatialGrid, area, minGap)) {
            // Score based on distance from ideal position
            const distanceFromIdeal = Math.sqrt(
              Math.pow(x - (baseX - totalWidth / 2), 2) + 
              Math.pow(y - baseY, 2)
            );
            positions.push({ x, y, score: distanceFromIdeal });
          }
        }
      }
      
      if (positions.length > 0) {
        const best = positions.reduce((a, b) => a.score < b.score ? a : b);
        return { x: best.x, y: best.y, width: totalWidth, height: maxHeight, id: 'bulk' };
      }
      
      return null;
    }
  ];
  
  // Try each strategy in order
  for (const strategy of searchStrategies) {
    const result = strategy();
    if (result) {
      return result;
    }
  }
  
  // Final fallback: Force placement with maximum separation
  const fallbackY = baseY + maxHeight * 3 + minGap * 5;
  
  // Find the furthest right node to avoid horizontal overlap
  let maxRight = baseX + totalWidth / 2;
  existingNodes.forEach(node => {
    const nodeWidth = estimateNodeWidth(node.data?.label || "");
    const nodeRight = node.position.x + nodeWidth / 2;
    if (nodeRight > maxRight && Math.abs(node.position.y - fallbackY) < maxHeight + minGap) {
      maxRight = nodeRight + minGap * 2;
    }
  });
  
  return {
    x: Math.max(baseX - totalWidth / 2, maxRight - totalWidth),
    y: fallbackY,
    width: totalWidth,
    height: maxHeight
  };
}

// --- Enhanced Individual Space Finding with Rigorous Collision Detection ---
function findOpenSpace(
  existingNodes: Node[],
  parentNode: Node,
  nodeWidth: number,
  nodeHeight: number,
  staggerOffset: number,
  childIndex: number,
  siblingCount: number
): { x: number; y: number } {
  // Create spatial grid for fast collision detection
  const spatialGrid = createSpatialGrid(existingNodes);
  
  // Calculate base position with improved stagger
  const sign = (childIndex % 2 === 0) ? 1 : -1;
  const offsetIdx = Math.floor((childIndex + 1) / 2);
  const baseStaggerY = sign * offsetIdx * (staggerY * 0.8);

  // Start from parent's position with dynamic gap
  const baseX = parentNode.position.x;
  const dynamicYGap = Math.max(yGap, nodeHeight * 1.5);
  const baseY = parentNode.position.y + dynamicYGap;
  const parentBottom = parentNode.position.y + nodeHeight;
  
  // Calculate initial spread with density awareness
  const totalWidth = siblingCount * (nodeWidth + xGap * 1.2);
  const initialSpread = (childIndex - (siblingCount - 1) / 2) * (nodeWidth + xGap);
  const proposedX = baseX + initialSpread;

  // Enhanced search strategies with comprehensive collision detection
  const searchStrategies = [
    // Strategy 1: Preferred position around ideal location
    () => {
      const preferredPositions = [
        { x: proposedX, y: baseY + baseStaggerY },
        { x: proposedX - nodeWidth, y: baseY + baseStaggerY },
        { x: proposedX + nodeWidth, y: baseY + baseStaggerY },
        { x: proposedX, y: baseY + baseStaggerY + nodeHeight },
        { x: proposedX, y: baseY + baseStaggerY - nodeHeight }
      ];
      
      for (const pos of preferredPositions) {
        if (pos.y <= parentBottom + nodeHeight/2) continue; // Too close to parent
        
        const area: BoundingBox = {
          x: pos.x - nodeWidth / 2,
          y: pos.y - nodeHeight / 2,
          width: nodeWidth,
          height: nodeHeight,
          id: 'test'
        };
        
        if (!checkAreaCollision(spatialGrid, area, minNodePadding)) {
          return { x: pos.x, y: pos.y };
        }
      }
      return null;
    },
    
    // Strategy 2: Spiral search from ideal position
    () => {
      const maxRadius = 300;
      const stepSize = 25;
      const angleStep = Math.PI / 12;
      
      for (let radius = stepSize; radius <= maxRadius; radius += stepSize) {
        const positions: Array<{x: number, y: number, score: number}> = [];
        
        for (let angle = 0; angle < Math.PI * 2; angle += angleStep) {
          const x = proposedX + Math.cos(angle) * radius;
          const y = Math.max(baseY + baseStaggerY, baseY + Math.abs(Math.sin(angle)) * radius);
          
          if (y <= parentBottom + nodeHeight/2) continue;
          
          const area: BoundingBox = {
            x: x - nodeWidth / 2,
            y: y - nodeHeight / 2,
            width: nodeWidth,
            height: nodeHeight,
            id: 'test'
          };
          
          if (!checkAreaCollision(spatialGrid, area, minNodePadding)) {
            const distanceFromIdeal = Math.sqrt(
              Math.pow(x - proposedX, 2) + Math.pow(y - (baseY + baseStaggerY), 2)
            );
            positions.push({ x, y, score: distanceFromIdeal });
          }
        }
        
        if (positions.length > 0) {
          const best = positions.reduce((a, b) => a.score < b.score ? a : b);
          return { x: best.x, y: best.y };
        }
      }
      return null;
    },
    
    // Strategy 3: Grid-based systematic search with density awareness
    () => {
      const searchWidth = 600;
      const searchHeight = 400;
      const gridStep = 20;
      
      const startX = proposedX - searchWidth / 2;
      const startY = baseY + baseStaggerY;
      
      // Calculate density map to avoid crowded areas
      const densityMap = new Map<string, number>();
      existingNodes.forEach(node => {
        const cellX = Math.floor(node.position.x / 50);
        const cellY = Math.floor(node.position.y / 50);
        for (let dx = -1; dx <= 1; dx++) {
          for (let dy = -1; dy <= 1; dy++) {
            const key = `${cellX + dx},${cellY + dy}`;
            densityMap.set(key, (densityMap.get(key) || 0) + 1);
          }
        }
      });
      
      const positions: Array<{x: number, y: number, score: number}> = [];
      
      for (let x = startX; x < startX + searchWidth; x += gridStep) {
        for (let y = startY; y < startY + searchHeight; y += gridStep) {
          if (y <= parentBottom + nodeHeight/2) continue;
          
          const area: BoundingBox = {
            x: x - nodeWidth / 2,
            y: y - nodeHeight / 2,
            width: nodeWidth,
            height: nodeHeight,
            id: 'test'
          };
          
          if (!checkAreaCollision(spatialGrid, area, minNodePadding)) {
            // Calculate score based on multiple factors
            const distanceFromIdeal = Math.sqrt(
              Math.pow(x - proposedX, 2) + Math.pow(y - (baseY + baseStaggerY), 2)
            );
            
            // Density penalty
            const densityKey = `${Math.floor(x / 50)},${Math.floor(y / 50)}`;
            const densityPenalty = (densityMap.get(densityKey) || 0) * 20;
            
            // Prefer positions closer to siblings but not too close
            const siblingDistance = Math.min(...existingNodes.map(node => 
              Math.sqrt(Math.pow(x - node.position.x, 2) + Math.pow(y - node.position.y, 2))
            ));
            const spacingBonus = Math.min(50, Math.max(0, siblingDistance - 100));
            
            const score = distanceFromIdeal + densityPenalty - spacingBonus;
            positions.push({ x, y, score });
          }
        }
      }
      
      if (positions.length > 0) {
        const best = positions.reduce((a, b) => a.score < b.score ? a : b);
        return { x: best.x, y: best.y };
      }
      
      return null;
    }
  ];
  
  // Try each strategy in order
  for (const strategy of searchStrategies) {
    const result = strategy();
    if (result) {
      return result;
    }
  }

  // Final fallback with guaranteed clear space
  const fallbackY = Math.max(
    baseY + baseStaggerY + nodeHeight * 3,
    Math.max(...existingNodes.map(n => n.position.y)) + nodeHeight * 2
  );
  
  return { 
    x: proposedX,
    y: fallbackY
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

// --- Debug and Validation Functions ---
function validateNodePositions(nodes: Node[], minGap: number = minNodePadding): {
  hasOverlaps: boolean;
  overlapCount: number;
  overlappingPairs: Array<{nodeA: string, nodeB: string, overlap: {x: number, y: number}}>;
} {
  const overlappingPairs: Array<{nodeA: string, nodeB: string, overlap: {x: number, y: number}}> = [];
  
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const nodeA = nodes[i];
      const nodeB = nodes[j];
      
      const widthA = estimateNodeWidth(nodeA.data?.label || "");
      const heightA = estimateNodeHeight();
      const widthB = estimateNodeWidth(nodeB.data?.label || "");
      const heightB = estimateNodeHeight();
      
      const boxA = {
        x: nodeA.position.x - widthA / 2,
        y: nodeA.position.y - heightA / 2,
        width: widthA,
        height: heightA
      };
      
      const boxB = {
        x: nodeB.position.x - widthB / 2,
        y: nodeB.position.y - heightB / 2,
        width: widthB,
        height: heightB
      };
      
      if (checkCollisionWithSpacing(boxA, boxB, minGap)) {
        const xOverlap = Math.max(0, Math.min(boxA.x + boxA.width, boxB.x + boxB.width) - Math.max(boxA.x, boxB.x));
        const yOverlap = Math.max(0, Math.min(boxA.y + boxA.height, boxB.y + boxB.height) - Math.max(boxA.y, boxB.y));
        
        overlappingPairs.push({
          nodeA: nodeA.id,
          nodeB: nodeB.id,
          overlap: { x: xOverlap, y: yOverlap }
        });
      }
    }
  }
  
  return {
    hasOverlaps: overlappingPairs.length > 0,
    overlapCount: overlappingPairs.length,
    overlappingPairs
  };
}

// --- Performance Monitoring ---
function measureLayoutPerformance<T>(operation: () => T, operationName: string): T {
  const start = performance.now();
  const result = operation();
  const end = performance.now();
  console.log(`${operationName} took ${(end - start).toFixed(2)}ms`);
  return result;
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
        
        // Move to next position with proper spacing
        currentX += childData.width + xGap;
      });
    }
  }

  if (idToNode[rootId]) {
    placeSubtree(rootId, 0, startX, startY);
  }
  return Object.values(idToNode);
}

// --- Advanced Overlap Resolver with Force-Directed Layout ---
function resolveNodeOverlapsBoundingBox(
  nodes: Node[],
  minGap = 12,
  maxIters = 50 // Increased iterations for better resolution
) {
  if (nodes.length === 0) return nodes;
  
  // Create spatial grid for efficient collision detection
  let spatialGrid = createSpatialGrid(nodes, 80);
  
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
      },
      _originalPos: { x: n.position.x, y: n.position.y }, // Store original position
      _moved: false
    };
  });

  // Track which nodes have been moved to prefer minimal disruption
  let totalMoved = 0;
  const maxMovedNodes = Math.ceil(boxes.length * 0.3); // Limit disruption to 30% of nodes

  for (let iter = 0; iter < maxIters; ++iter) {
    let moved = false;
    const forces = new Map<string, {x: number, y: number, count: number}>();
    
    // Initialize forces
    boxes.forEach(box => {
      forces.set(box.id, { x: 0, y: 0, count: 0 });
    });

    // Calculate repulsion forces between overlapping nodes
    for (let i = 0; i < boxes.length; ++i) {
      for (let j = i + 1; j < boxes.length; ++j) {
        const a = boxes[i]._box;
        const b = boxes[j]._box;
        
        const xOverlap = Math.max(0, Math.min(a.x + a.w + minGap, b.x + b.w + minGap) - Math.max(a.x, b.x));
        const yOverlap = Math.max(0, Math.min(a.y + a.h + minGap, b.y + b.h + minGap) - Math.max(a.y, b.y));
        
        if (xOverlap > minGap && yOverlap > minGap) {
          // Calculate repulsion force
          const overlapArea = xOverlap * yOverlap;
          const forceStrength = Math.sqrt(overlapArea) * 0.5;
          
          // Determine separation direction (prefer horizontal separation for mind maps)
          let fx = 0, fy = 0;
          
          if (xOverlap > yOverlap) {
            // Separate vertically
            fy = (yOverlap - minGap) / 2 + forceStrength;
            if (a.y < b.y) {
              fy = -fy; // Move 'a' up, 'b' down
            }
          } else {
            // Separate horizontally
            fx = (xOverlap - minGap) / 2 + forceStrength;
            if (a.x < b.x) {
              fx = -fx; // Move 'a' left, 'b' right
            }
          }
          
          // Apply forces
          const forceA = forces.get(boxes[i].id)!;
          const forceB = forces.get(boxes[j].id)!;
          
          forceA.x -= fx;
          forceA.y -= fy;
          forceA.count++;
          
          forceB.x += fx;
          forceB.y += fy;
          forceB.count++;
        }
      }
    }

    // Apply forces with dampening and constraints
    boxes.forEach((box, index) => {
      const force = forces.get(box.id)!;
      
      if (force.count > 0 && totalMoved < maxMovedNodes && !box._moved) {
        // Dampen force application
        const damping = 0.6;
        const maxMove = 30; // Limit single-iteration movement
        
        let dx = Math.max(-maxMove, Math.min(maxMove, force.x * damping / force.count));
        let dy = Math.max(-maxMove, Math.min(maxMove, force.y * damping / force.count));
        
        // Prefer vertical movement for mind maps (maintain horizontal relationships)
        if (Math.abs(dx) > Math.abs(dy)) {
          dx *= 0.7; // Reduce horizontal movement
          dy *= 1.3; // Emphasize vertical movement
        }
        
        // Apply movement
        boxes[index].position.x += dx;
        boxes[index].position.y += dy;
        
        // Update bounding box
        boxes[index]._box.x = boxes[index].position.x - box._box.w / 2;
        boxes[index]._box.y = boxes[index].position.y - box._box.h / 2;
        boxes[index]._box.centerX = boxes[index].position.x;
        boxes[index]._box.centerY = boxes[index].position.y;
        
        if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
          moved = true;
          if (!box._moved) {
            box._moved = true;
            totalMoved++;
          }
        }
      }
    });

    // Early termination if no significant movement
    if (!moved) break;
    
    // Update spatial grid every few iterations for performance
    if (iter % 5 === 0) {
      spatialGrid = createSpatialGrid(boxes, 80);
    }
  }

  // Final validation pass - ensure no overlaps remain
  for (let i = 0; i < boxes.length; ++i) {
    for (let j = i + 1; j < boxes.length; ++j) {
      const a = boxes[i]._box;
      const b = boxes[j]._box;
      
      const xOverlap = Math.max(0, Math.min(a.x + a.w + minGap, b.x + b.w + minGap) - Math.max(a.x, b.x));
      const yOverlap = Math.max(0, Math.min(a.y + a.h + minGap, b.y + b.h + minGap) - Math.max(a.y, b.y));
      
      if (xOverlap > minGap && yOverlap > minGap) {
        // Force final separation
        const pushY = (yOverlap - minGap) / 2 + 5;
        boxes[i].position.y -= pushY;
        boxes[j].position.y += pushY;
        
        // Update bounding boxes
        boxes[i]._box.y = boxes[i].position.y - a.h / 2;
        boxes[j]._box.y = boxes[j].position.y - b.h / 2;
      }
    }
  }

  return boxes.map(({ _box, _originalPos, _moved, ...node }) => node);
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

  // Cache child map and descendant relationships to avoid recalculation
  const childMapRef = useRef<Record<string, string[]>>({});
  const descendantMapRef = useRef<Record<string, Set<string>>>({});
  
  // Update child map and descendant relationships when edges change
  useEffect(() => {
    childMapRef.current = getChildMap(edges);
    
    // Pre-calculate all descendant relationships for fast lookup
    const descendantMap: Record<string, Set<string>> = {};
    const nodeIds = [...new Set([...edges.map(e => e.source), ...edges.map(e => e.target)])];
    
    nodeIds.forEach(nodeId => {
      descendantMap[nodeId] = new Set(getDescendantIds(nodeId, childMapRef.current));
    });
    
    descendantMapRef.current = descendantMap;
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

        // Create a map for faster node lookup
        const nodeMap = new Map<string, number>();
        newNodes.forEach((node, index) => {
          nodeMap.set(node.id, index);
        });

        // Batch all position updates to minimize array mutations
        const positionUpdates = new Map<string, { x: number; y: number }>();

        // Process each position change
        posChanges.forEach(change => {
          const nodeIndex = nodeMap.get(change.id);
          if (nodeIndex === undefined || !change.position) return;

          const node = newNodes[nodeIndex];
          
          // Calculate the movement delta
          const dx = change.position.x - node.position.x;
          const dy = change.position.y - node.position.y;

          // Skip if no actual movement
          if (dx === 0 && dy === 0) return;

          // Get all descendants that need to move with this node (use cached descendants)
          const descendants = descendantMapRef.current[change.id] || new Set();

          // Queue position updates for the node and all its descendants
          positionUpdates.set(change.id, {
            x: node.position.x + dx,
            y: node.position.y + dy
          });

          descendants.forEach(descendantId => {
            const descendantIndex = nodeMap.get(descendantId);
            if (descendantIndex !== undefined) {
              const descendantNode = newNodes[descendantIndex];
              positionUpdates.set(descendantId, {
                x: descendantNode.position.x + dx,
                y: descendantNode.position.y + dy
              });
            }
          });
        });

        // Apply all position updates in a single pass
        if (positionUpdates.size > 0) {
          newNodes = newNodes.map(n => {
            const newPos = positionUpdates.get(n.id);
            if (newPos) {
              // Store positions immediately during dragging for persistence
              userPositionsRef.current[n.id] = newPos;
              return { ...n, position: newPos };
            }
            return n;
          });
        }

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
        let positionedNodes = measureLayoutPerformance(
          () => assignStaggeredTreePositions(
            baseNodes, baseEdges, mainNodeId, startX, startY, xGap, yGap, staggerY, userPositionsRef.current
          ),
          "Initial mind map positioning"
        );
        
        positionedNodes = measureLayoutPerformance(
          () => resolveNodeOverlapsBoundingBox(positionedNodes, minNodePadding, 40),
          "Initial mind map overlap resolution"
        );
        
        // Validate initial layout
        const validation = validateNodePositions(positionedNodes, minNodePadding);
        if (validation.hasOverlaps) {
          console.warn(`Initial layout has ${validation.overlapCount} overlapping pairs, applying additional cleanup`);
          positionedNodes = resolveNodeOverlapsBoundingBox(positionedNodes, minNodePadding, 30);
        } else {
          console.log("✅ Initial mind map layout validation passed");
        }
        
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
        const mainNodeId = finalMerged.nodes[0]?.id || "main";
        let positionedNodes = measureLayoutPerformance(
          () => assignStaggeredTreePositions(
            finalMerged.nodes, 
            finalMerged.edges, 
            mainNodeId, 
            startX, 
            startY, 
            xGap, 
            yGap, 
            staggerY, 
            existingPositions
          ),
          "Initial node positioning"
        );

        // Resolve overlaps with enhanced collision detection
        const nodesToResolve = positionedNodes.filter(n => !existingPositions[n.id]);
        if (nodesToResolve.length > 0) {
          const resolvedNewNodes = measureLayoutPerformance(
            () => resolveNodeOverlapsBoundingBox(nodesToResolve, minNodePadding, 50),
            "Overlap resolution"
          );
          // Merge back resolved nodes
          positionedNodes = positionedNodes.map(n => 
            existingPositions[n.id] ? n : resolvedNewNodes.find(rn => rn.id === n.id) || n
          );
        }

        // Validate final layout
        const validation = validateNodePositions(positionedNodes, minNodePadding);
        if (validation.hasOverlaps) {
          console.warn(`Layout validation found ${validation.overlapCount} overlapping node pairs:`, validation.overlappingPairs);
          
          // Apply final overlap resolution to all nodes if needed
          positionedNodes = measureLayoutPerformance(
            () => resolveNodeOverlapsBoundingBox(positionedNodes, minNodePadding, 25),
            "Final overlap cleanup"
          );
        } else {
          console.log("✅ Layout validation passed - no overlaps detected");
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
          let positionedNodes = measureLayoutPerformance(
            () => assignStaggeredTreePositions(
              merged.nodes, 
              merged.edges, 
              mainNodeId, 
              startX, 
              startY, 
              xGap, 
              yGap, 
              staggerY, 
              existingPositions
            ),
            `Automation layout ${i + 1}`
          );

          // Resolve overlaps only for nodes without user positions
          const nodesToResolve = positionedNodes.filter(n => !existingPositions[n.id]);
          if (nodesToResolve.length > 0) {
            const resolvedNewNodes = measureLayoutPerformance(
              () => resolveNodeOverlapsBoundingBox(nodesToResolve, minNodePadding, 40),
              `Automation overlap resolution ${i + 1}`
            );
            // Merge back resolved nodes
            positionedNodes = positionedNodes.map(n => 
              existingPositions[n.id] ? n : resolvedNewNodes.find(rn => rn.id === n.id) || n
            );
          }

          // Quick validation for automation
          const validation = validateNodePositions(positionedNodes, minNodePadding);
          if (validation.hasOverlaps && validation.overlapCount > 3) {
            console.warn(`Automation step ${i + 1}: ${validation.overlapCount} overlaps detected, applying cleanup`);
            positionedNodes = resolveNodeOverlapsBoundingBox(positionedNodes, minNodePadding, 20);
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
