import type { VercelRequest, VercelResponse } from "@vercel/node";
import OpenAI from "openai";

// Secure OpenAI key from env
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

// Compose a prompt for GPT, including current map context
function buildPrompt(userQuery: string, mindMapContext: any) {
  return `
You are an AI knowledge map builder. The user will ask a question and provide the current mind map (nodes, edges, groups).
Your job is to return a new/updated set of concepts and relationships, in JSON.

Return a JSON of this shape:
{
  nodes: [ { id, label, group, type, preview, collapsed, ... } ],
  edges: [ { id, source, target, type } ]
}

Rules:
- "preview" nodes should be suggested expansion points, semi-transparent, and can be expanded by the user.
- Use "group" to cluster concepts.
- Use "type" in edges: "informs", "depends on", "related".
- Try to minimize duplication and maximize visual clarity.

Current mind map (context):
${JSON.stringify(mindMapContext)}

User query: "${userQuery}"

Return only valid JSON, no explanation.
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
