import React from "react";
import { Handle, NodeProps, Position } from "reactflow";

const MindMapNode: React.FC<NodeProps> = ({ data, isConnectable, selected }) => (
  <div
    style={{
      background: "#fff",
      border: selected ? "2px solid #7c3aed" : "1.5px solid #bbb",
      borderRadius: 8,
      padding: "4px 16px",
      minWidth: 60,
      height: 26,
      boxShadow: "0 2px 7px rgba(0,0,0,0.09)",
      textAlign: "center",
      userSelect: "none",
      cursor: "grab",
      fontWeight: 500,
      transition: "border 0.12s ease-in-out",
      width: "fit-content",
      fontSize: 13,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      lineHeight: 1,
      whiteSpace: "nowrap",
    }}
    tabIndex={0}
    role="button"
    aria-label={data.label}
  >
    {data.label}
    <Handle
      type="source"
      position={Position.Bottom}
      style={{ opacity: 0 }}
      isConnectable={isConnectable}
    />
    <Handle
      type="target"
      position={Position.Top}
      style={{ opacity: 0 }}
      isConnectable={isConnectable}
    />
  </div>
);

export default MindMapNode;
