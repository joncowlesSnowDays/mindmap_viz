import { useState } from "react";
import axios from "axios";

// Custom hook to handle calls to backend GPT API
export function useGPT() {
  const [loading, setLoading] = useState(false);
  const [infoLoading, setInfoLoading] = useState(false);

  const queryNodeInfo = async (nodeId: string, nodeLabel: string, childLabels: string[] = []) => {
    setInfoLoading(true);
    try {
      const res = await axios.post("/api/gpt", {
        type: "getInfo",
        nodeId,
        nodeLabel,
        childLabels,
      });
      setInfoLoading(false);
      return res.data.content;
    } catch (e: any) {
      setInfoLoading(false);
      console.error("Info query failed:", e);
      return "Failed to load information. Please try again.";
    }
  };

  const queryGPT = async (
    userQuery: string,
    mindMapContext: any,
    selectedNodeId: string | null = null
  ) => {
    setLoading(true);
    try {
      const res = await axios.post("/api/gpt", {
        userQuery,
        mindMapContext,
        selectedNodeId, // pass selectedNodeId to backend!
      });
      setLoading(false);
      return res.data;
    } catch (e: any) {
      setLoading(false);
      alert("AI query failed: " + (e?.message || e));
      return null;
    }
  };

  return { queryGPT, queryNodeInfo, loading, infoLoading };
}
