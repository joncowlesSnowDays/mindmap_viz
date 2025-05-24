import React, { useState } from "react";
import MindMap from "./components/MindMap.tsx";
import NodePanel from "./components/NodePanel.tsx";

// Top-level app with sidebar (search, query input) and MindMap area
const App: React.FC = () => {
  const [userInput, setUserInput] = useState("");
  const [userQuery, setUserQuery] = useState("");        // This is only set on initial submit/reset
  const [triggerUpdate, setTriggerUpdate] = useState(0);
  const [hasInitialized, setHasInitialized] = useState(false);

  // Submit initial user query, disable further input until reset
  const onSubmitQuery = (e: React.FormEvent) => {
    e.preventDefault();
    if (!hasInitialized && userInput.trim()) {
      setUserQuery(userInput.trim());
      setTriggerUpdate((n) => n + 1);
      setHasInitialized(true);
    }
  };

  // Reset: clear everything and allow new topic
  const onReset = () => {
    setUserInput("");
    setUserQuery("");
    setHasInitialized(false);
    setTriggerUpdate((n) => n + 1); // Will trigger map reset (MindMap should handle empty query/reset)
  };

  return (
    <div style={{ display: "flex", height: "100vh" }}>
      <div className="sidebar">
        <h1>AI Mind Map Visualizer</h1>
        <form onSubmit={onSubmitQuery}>
          <input
            type="text"
            placeholder="Ask about any concept…"
            value={userInput}
            onChange={(e) => setUserInput(e.target.value)}
            style={{ width: "100%", marginBottom: 8, padding: 8, fontSize: 16 }}
            disabled={hasInitialized}
          />
          {!hasInitialized ? (
            <button type="submit" style={{ width: "100%", padding: 8 }} disabled={!userInput.trim()}>
              Query AI
            </button>
          ) : (
            <button type="button" style={{ width: "100%", padding: 8, background: "#f87171" }} onClick={onReset}>
              Reset Mind Map
            </button>
          )}
        </form>
        <NodePanel triggerUpdate={triggerUpdate} />
      </div>
      <MindMap userQuery={userQuery} triggerUpdate={triggerUpdate} />
    </div>
  );
};

export default App;
