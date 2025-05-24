import React, { useState } from "react";
import MindMap from "./components/MindMap.tsx";
import NodePanel from "./components/NodePanel.tsx";

const App: React.FC = () => {
  const [userQuery, setUserQuery] = useState("");
  const [triggerUpdate, setTriggerUpdate] = useState(0);
  const [hasQueried, setHasQueried] = useState(false);
  const [resetSignal, setResetSignal] = useState(0); // To force a MindMap reset

  // Called when user submits a query
  const onSubmitQuery = (e: React.FormEvent) => {
    e.preventDefault();
    if (userQuery.trim()) {
      setHasQueried(true);
      setTriggerUpdate((n) => n + 1);
    }
  };

  // Handle the reset logic
  const onReset = () => {
    setUserQuery("");
    setHasQueried(false);
    setResetSignal((n) => n + 1); // This will reset MindMap completely
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
            disabled={hasQueried}
          />
          <button type="submit" style={{ width: "100%", padding: 8 }} disabled={hasQueried || !userQuery.trim()}>
            {hasQueried ? "Reset Mind Map" : "Query AI"}
          </button>
          {hasQueried && (
            <button type="button" style={{ width: "100%", padding: 8, marginTop: 4 }} onClick={onReset}>
              Reset Mind Map
            </button>
          )}
        </form>
        <NodePanel triggerUpdate={triggerUpdate} />
      </div>
      <MindMap
        userQuery={userQuery}
        triggerUpdate={triggerUpdate}
        resetSignal={resetSignal} // <-- Pass to MindMap for full reset
      />
    </div>
  );
};

export default App;
