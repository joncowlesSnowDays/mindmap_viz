import React from "react";

// Visual legend for color codes/types
const Legend: React.FC = () => (
  <div style={{
    position: "absolute", bottom: 18, left: 22, background: "#fff",
    border: "1px solid #eee", padding: "8px 20px", borderRadius: 10,
    fontSize: 14, color: "#333", zIndex: 10, boxShadow: "0 1px 4px #0001"
  }}>
    <b>Legend:</b>
    <ul style={{ margin: "6px 0 0 0", padding: 0, listStyle: "none" }}>
      <li><span style={{ color: "#3b82f6" }}>●</span> <b>Informs</b> (blue connector)</li>
      <li><span style={{ color: "#22c55e" }}>●</span> <b>Depends on</b> (green connector)</li>
      <li><span style={{ color: "#f59e42" }}>●</span> <b>Related</b> (orange connector)</li>
      <li><span style={{ color: "#c026d3" }}>●</span> <b>Preview node</b> (dashed border, click to expand)</li>
      <li><span style={{ color: "#444" }}>●</span> <b>Collapsed group</b> (minimized frame)</li>
    </ul>
  </div>
);

export default Legend;
