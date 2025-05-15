import type { VercelRequest, VercelResponse } from "@vercel/node";
import OpenAI from "openai";

// Secure OpenAI key from env
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

// Compose a prompt for GPT, including current map context
function buildPrompt(userQuery: string, mindMapContext: any) {
  return `
You are an AI knowledge map builder. The user will ask a question and provide the current mind map (nodes, edges, groups).
Your job is to return an updated set of concepts and relationships in JSON, expanding the selected topic with **two new layers** of children.

**Your Task:**
- Find the node that best matches the user's query or is selected for expansion.
- For that node:
  - Generate 4-8 direct children (Layer 1), each a meaningful subtopic or key aspect.
  - For each child, generate 2-4 children of their own (Layer 2), as sub-aspects, examples, or further breakdowns.
- If any of these should be "preview" nodes (for future expansion), set \`"preview": true\`.
- Make sure all nodes have unique "id", "label", and belong to a logical "group" if appropriate.

**Node and Edge Structure:**
Return a JSON like:
{
  nodes: [ { id, label, group, type, preview, collapsed, ... } ],
  edges: [ { id, source, target, type } ]
}
Where:
- "group" clusters related concepts visually.
- "type" in edges is one of: "informs", "depends on", "related".
- "preview" nodes are semi-transparent, for user expansion.
- Avoid duplicating nodes already present in the mind map.
- Place new nodes in clear, logical relationships, minimizing clutter.

**Rules:**
- Expand only the node relevant to the user query by two layers.
- Do **not** connect nodes in Layer 2 directly to the root node unless logically necessary.
- Don’t return explanations, only valid, parseable JSON as shown.
- Use unique, stable IDs (don’t re-use IDs of existing nodes unless updating).
- Try to maximize visual clarity.

**Current mind map (context):**
${JSON.stringify(mindMapContext)}

**User query:** "${userQuery}"

Return only the updated mind map JSON.
  `;
}


export default async function handler(req: VercelRequest, res: VercelResponse) {
  const { userQuery, mindMapContext } = req.body;
  const prompt = buildPrompt(userQuery, mindMapContext);

  // --- Debug logs start ---
  console.log("API key:", process.env.OPENAI_API_KEY ? "present" : "missing");
  console.log("userQuery:", userQuery);
  console.log("mindMapContext:", mindMapContext);
  // --- Debug logs end ---

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "system", content: "You are an expert knowledge graph/mind map generator." },
        { role: "user", content: prompt }
      ],
      response_format: { type: "json_object" },
      max_tokens: 1024,
      temperature: 0.3
    });

    // Parse the model's JSON response
    const content = completion.choices[0]?.message?.content;
    let json = null;
    try {
      json = typeof content === "string" ? JSON.parse(content) : content;
    } catch (e) {
      console.log("JSON parse error:", e); // <--- Add a debug log for parse errors
      return res.status(200).json({ nodes: [], edges: [], error: "LLM output parse error" });
    }
    res.status(200).json(json);
  } catch (err: any) {
    console.error("OpenAI API error:", err); // <--- Add error debug log
    res.status(500).json({ error: "OpenAI API error", details: err?.message });
  }
}
