import React from "react";
import { Handle, NodeProps, Position } from "reactflow";

interface MindMapNodeProps extends NodeProps {
  onInfoClick?: (nodeId: string) => void;
}

const MindMapNode: React.FC<MindMapNodeProps> = ({ data, isConnectable, selected, id }) => {
  console.log('Node render:', { id, label: data.label, onInfoClick: !!data.onInfoClick });
  
  return (
    <div
      style={{
        background: "#fff",
        border: selected ? "2px solid #7c3aed" : "1.5px solid #bbb",
        borderRadius: 12,
        padding: "8px 16px",
        minWidth: 120,
        boxShadow: "0 2px 7px rgba(0,0,0,0.09)",
        textAlign: "left",
        userSelect: "none",
        cursor: "grab",
        fontWeight: 500,
        transition: "border 0.12s ease-in-out",
        width: "fit-content",
        fontSize: 16,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        lineHeight: 1.2,
        whiteSpace: "nowrap",
        position: "relative",
      }}
      tabIndex={0}
      role="button"
      aria-label={data.label}
    >
      <span style={{ flex: 1 }}>{data.label}</span>
      {!data.isRoot && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            console.log('Info button clicked for node:', id);
            data.onInfoClick?.(id);
          }}
          style={{
            width: 24,
            height: 24,
            padding: 0,
            border: "none",
            background: "none",
            cursor: "pointer",
            opacity: 0.6,
            transition: "opacity 0.2s",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.opacity = "1";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.opacity = "0.6";
          }}
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <circle cx="12" cy="12" r="10" />
            <path d="M12 16v-4" />
            <path d="M12 8h.01" />
          </svg>
        </button>
      )}
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
};

export default MindMapNode;
