import { useState } from "react";
import axios from "axios";

// Custom hook to handle calls to backend GPT API
export function useGPT() {
  const [loading, setLoading] = useState(false);

  // Add selectedNodeId as a third parameter
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

  return { queryGPT, loading };
}
