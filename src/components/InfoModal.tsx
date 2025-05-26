import React from "react";

interface InfoModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  content: string;
  loading?: boolean;
}

const InfoModal: React.FC<InfoModalProps> = ({ isOpen, onClose, title, content, loading }) => {
  if (!isOpen) return null;

  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        right: 0,
        width: "400px",
        height: "100vh",
        background: "white",
        boxShadow: "-2px 0 12px rgba(0,0,0,0.1)",
        padding: "24px",
        overflowY: "auto",
        zIndex: 1000,
        animation: "slideIn 0.3s ease-out"
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <h3 style={{ margin: 0, fontSize: 18 }}>{title}</h3>
        <button
          onClick={onClose}
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            padding: 4,
          }}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M18 6L6 18" />
            <path d="M6 6l12 12" />
          </svg>
        </button>
      </div>
      
      {loading ? (
        <div style={{ 
          display: "flex", 
          alignItems: "center", 
          gap: 8, 
          color: "#666",
          fontSize: 14
        }}>
          <div style={{ 
            width: 16, 
            height: 16, 
            border: "2px solid #7c3aed", 
            borderRightColor: "transparent", 
            borderRadius: "50%", 
            animation: "spin 1s linear infinite" 
          }} />
          Generating information...
        </div>
      ) : (
        <div style={{
          fontSize: 14,
          lineHeight: 1.6,
          color: "#333"
        }}>
          {content}
        </div>
      )}
    </div>
  );
};

export default InfoModal;
