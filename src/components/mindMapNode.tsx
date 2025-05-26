import React from "react";
import { Handle, NodeProps, Position } from "reactflow";

const MindMapNode: React.FC<NodeProps> = ({ data, isConnectable, selected }) => (
  <div
    style={{
      background: "#fff",
      border: selected ? "2px solid #7c3aed" : "1.5px solid #bbb",
      borderRadius: 12,
      padding: "14px 28px",
      minWidth: 60,
      minHeight: 48,
      boxShadow: "0 2px 7px rgba(0,0,0,0.09)",
      textAlign: "center",
      userSelect: "none",
      cursor: "grab",
      fontWeight: 500,
      transition: "border 0.12s",
      width: "fit-content",
      pointerEvents: "auto", // ensure node is interactive
    }}
    onClick={data.onClick} // triggers expansion/API call
    tabIndex={0}
  >
    {data.label}
    {/* Handles must not block pointer events */}
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
