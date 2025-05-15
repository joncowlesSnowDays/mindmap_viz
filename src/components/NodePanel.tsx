import React from "react";

// Sidebar: search/filter panel (stub for now, expand as needed)
const NodePanel: React.FC<{ triggerUpdate: number }> = ({ triggerUpdate }) => {
  return (
    <div style={{ marginTop: 24 }}>
      <h3>Search/Filter (Coming Soon)</h3>
      <input type="text" placeholder="Search..." style={{ width: "100%", padding: 6 }} disabled />
      <ul style={{ fontSize: 14, color: "#777", marginTop: 8 }}>
        <li>Find concepts or nodes by name</li>
        <li>Highlight or zoom to results</li>
        <li>Filter by group, type, or relationship</li>
      </ul>
      <hr />
      <p style={{ fontSize: 13, color: "#888" }}>
        v1 starter – expand with actual search/filter logic using <code>nodes</code> from MindMap.
      </p>
    </div>
  );
};

export default NodePanel;
