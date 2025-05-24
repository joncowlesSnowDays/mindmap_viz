import React from "react";
import { Handle, NodeProps, Position } from "reactflow"; // <-- Position is the key

const MindMapNode: React.FC<NodeProps> = ({ data, isConnectable }) => (
  <div
    style={{
      background: "#fff",
      border: "1.5px solid #bbb",
      borderRadius: 12,
      padding: "10px 20px",
      cursor: "grab",
      minWidth: 80,
      boxShadow: "0 2px 7px rgba(0,0,0,0.09)",
      textAlign: "center",
      userSelect: "none"
    }}
  >
    {data.label}
    {/* Invisible handles so node is always draggable and connectable */}
    <Handle
      type="source"
      position={Position.Right}   // Use enum, not string
      style={{ opacity: 0 }}
      isConnectable={isConnectable}
    />
    <Handle
      type="target"
      position={Position.Left}     // Use enum, not string
      style={{ opacity: 0 }}
      isConnectable={isConnectable}
    />
  </div>
);

export default MindMapNode;
