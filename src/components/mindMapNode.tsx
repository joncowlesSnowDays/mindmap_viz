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
      transition: "border 0.12s ease-in-out",
      width: "fit-content",
    }}
    tabIndex={0}
    role="button"
    aria-label={data.label}
  >
    {data.label}
    <Handle
      type="source"
      position={Position.Right}
      style={{ 
        background: "#555",
        width: 8,
        height: 8,
        border: "2px solid white"
      }}
      isConnectable={isConnectable}
    />
    <Handle
      type="target"
      position={Position.Left}
      style={{ 
        background: "#555",
        width: 8,
        height: 8,
        border: "2px solid white"
      }}
      isConnectable={isConnectable}
    />
    <Handle
      type="source"
      position={Position.Top}
      style={{ 
        background: "#555",
        width: 8,
        height: 8,
        border: "2px solid white"
      }}
      isConnectable={isConnectable}
    />
    <Handle
      type="target"
      position={Position.Bottom}
      style={{ 
        background: "#555",
        width: 8,
        height: 8,
        border: "2px solid white"
      }}
      isConnectable={isConnectable}
    />
  </div>
);

export default MindMapNode;
