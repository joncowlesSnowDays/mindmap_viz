import { useState } from "react";
import axios from "axios";

// Custom hook to handle calls to backend GPT API
export function useGPT() {
  const [loading, setLoading] = useState(false);

  const queryGPT = async (userQuery: string, mindMapContext: any) => {
    setLoading(true);
    try {
      const res = await axios.post("/api/gpt", { userQuery, mindMapContext });
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
