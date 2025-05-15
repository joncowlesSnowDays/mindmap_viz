import React, { useState } from "react";
import MindMap from "./components/MindMap.tsx";
import NodePanel from "./components/NodePanel.tsx";

// Top-level app with sidebar (search, query input) and MindMap area
const App: React.FC = () => {
  const [userQuery, setUserQuery] = useState("");
  const [triggerUpdate, setTriggerUpdate] = useState(0);

  // Called when user submits a query
  const onSubmitQuery = (e: React.FormEvent) => {
    e.preventDefault();
    setTriggerUpdate((n) => n + 1);
  };

  return (
    <div style={{ display: "flex", height: "100vh" }}>
      <div className="sidebar">
        <h1>AI Mind Map Visualizer</h1>
        <form onSubmit={onSubmitQuery}>
          <input
            type="text"
            placeholder="Ask about any concept…"
            value={userQuery}
            onChange={(e) => setUserQuery(e.target.value)}
            style={{ width: "100%", marginBottom: 8, padding: 8, fontSize: 16 }}
          />
          <button type="submit" style={{ width: "100%", padding: 8 }}>Query AI</button>
        </form>
        <NodePanel triggerUpdate={triggerUpdate} />
      </div>
      <MindMap userQuery={userQuery} triggerUpdate={triggerUpdate} />
    </div>
  );
};

export default App;
