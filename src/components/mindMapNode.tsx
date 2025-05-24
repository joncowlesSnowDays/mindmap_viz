import React from "react";
import { Handle, NodeProps, Position } from "reactflow";

const MindMapNode: React.FC<NodeProps> = ({ data, isConnectable, selected }) => (
  <div
    style={{
      background: "#fff",
      border: selected ? "2px solid #7c3aed" : "1.5px solid #bbb",
      borderRadius: 12,
      padding: "14px 28px",
      minWidth: 90,
      minHeight: 48,
      boxShadow: "0 2px 7px rgba(0,0,0,0.09)",
      textAlign: "center",
      userSelect: "none",
      cursor: "grab",
      fontWeight: 500,
      transition: "border 0.12s"
    }}
    // Allows node to be clickable anywhere for expansion
    onClick={data.onClick}
    tabIndex={0} // enables keyboard accessibility if desired
  >
    {data.label}
    {/* Invisible handles for connecting edges, don't block clicks/drags */}
    <Handle
      type="source"
      position={Position.Right}
      style={{ opacity: 0, pointerEvents: "none" }}
      isConnectable={isConnectable}
    />
    <Handle
      type="target"
      position={Position.Left}
      style={{ opacity: 0, pointerEvents: "none" }}
      isConnectable={isConnectable}
    />
  </div>
);

export default MindMapNode;
