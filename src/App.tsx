import React, { useState } from "react";
import MindMap from "./components/MindMap.tsx";
import NodePanel from "./components/NodePanel.tsx";

const App: React.FC = () => {
  const [userQuery, setUserQuery] = useState("");
  const [triggerUpdate, setTriggerUpdate] = useState(0);
  const [automateCount, setAutomateCount] = useState(3);
  const [automateSignal, setAutomateSignal] = useState(0);

  // Called when user submits a query
  const onSubmitQuery = (e: React.FormEvent) => {
    e.preventDefault();
    setTriggerUpdate((n) => n + 1);
  };

  const onReset = () => {
    setUserQuery("");
    setTriggerUpdate((n) => n + 1); // Forces MindMap to reset
  };

  const onAutomate = () => {
    setAutomateSignal((n) => n + 1);
  };

  return (
    <div style={{ display: "flex", height: "100vh" }}>
      <div className="sidebar" style={{ minWidth: 320 }}>
        <h1>AI Mind Map Visualizer</h1>
        <form onSubmit={onSubmitQuery}>
          <input
            type="text"
            placeholder="Ask about any concept…"
            value={userQuery}
            onChange={(e) => setUserQuery(e.target.value)}
            style={{ width: "100%", marginBottom: 8, padding: 8, fontSize: 16 }}
          />
          <button type="submit" style={{ width: "100%", padding: 8, marginBottom: 4 }}>
            Query AI
          </button>
        </form>
        <button onClick={onReset} style={{ width: "100%", padding: 8, marginBottom: 12 }}>
          Reset Mind Map
        </button>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
          <input
            type="number"
            min={1}
            max={30}
            value={automateCount}
            onChange={e => setAutomateCount(Number(e.target.value))}
            style={{ width: 56, padding: 6 }}
          />
          <button onClick={onAutomate} style={{ flex: 1, padding: 8 }}>
            Automate
          </button>
        </div>
        <NodePanel triggerUpdate={triggerUpdate} />
      </div>
      <MindMap
        userQuery={userQuery}
        triggerUpdate={triggerUpdate}
        automateCount={automateCount}
        automateSignal={automateSignal}
        key={triggerUpdate} // ensures reset
      />
    </div>
  );
};

export default App;
