import type { VercelRequest, VercelResponse } from "@vercel/node";
import OpenAI from "openai";

// Secure OpenAI key from env
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

// Build GPT prompt for either full map or partial expansion
function buildPrompt(userQuery: string, mindMapContext: any, selectedNodeId?: string | null) {
  if (!selectedNodeId) {
    // Build a NEW mind map for a fresh query
    return `
You are an AI mind map builder.
Build a new knowledge map for the topic: "${userQuery}".

- Create a root node for the topic.
- Add 4-8 direct children (main subtopics). Each must be a key aspect, branch, or subdomain.
- For each child node, set "preview": true if you want it to be expanded by the user later.
- Output valid JSON using this structure:

{
  "nodes": [
    { "id": "root", "label": "Main Topic", "group": "Group A", "type": "concept", "preview": false, "collapsed": false },
    { "id": "child1", "label": "Subtopic 1", "group": "Group A", "type": "concept", "preview": true, "collapsed": false }
    // ...
  ],
  "edges": [
    { "id": "e-root-child1", "source": "root", "target": "child1", "type": "informs" }
    // ...
  ]
}
Do NOT return grandchildren (only one layer of children).
Do NOT include extra text, comments, or explanations. Only valid JSON.
    `.trim();
  } else {
    // Partial expansion: expand only the selected node
    return `
You are an AI mind map builder.
Expand ONLY the selected node with id "${selectedNodeId}" from the mind map below:

${JSON.stringify(mindMapContext, null, 2)}

- Generate 3-6 new direct children (meaningful subtopics or key aspects) for the selected node.
- For each new child node, set "preview": true if you want it to be expandable by the user later.
- Output ONLY the new nodes and edges you create, NOT the entire mind map.
- All IDs must be unique and not conflict with those already present in the context.
- Output valid JSON using this structure:

{
  "nodes": [
    // new direct children only
    { "id": "new_id_1", "label": "Subtopic A", "group": "Some Group", "type": "concept", "preview": true, "collapsed": false }
  ],
  "edges": [
    // new edges, each connects selectedNodeId to a new child
    { "id": "e-selectedNodeId-new_id_1", "source": "${selectedNodeId}", "target": "new_id_1", "type": "informs" }
  ]
}
Do NOT return the full map, only new nodes and new edges.
Do NOT include comments or extra text—only valid JSON.
If you generate no new nodes, return empty arrays for nodes and edges.
    `.trim();
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Accept userQuery, mindMapContext, selectedNodeId from request body
  const { userQuery, mindMapContext, selectedNodeId } = req.body;
  const prompt = buildPrompt(userQuery, mindMapContext, selectedNodeId);

  // --- Debug logs start ---
  console.log("API key:", process.env.OPENAI_API_KEY ? "present" : "missing");
  console.log("userQuery:", userQuery);
  console.log("selectedNodeId:", selectedNodeId);
  console.log("mindMapContext:", mindMapContext);
  console.log("Prompt sent to OpenAI:", prompt);
  // --- Debug logs end ---

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "system", content: "You are an expert knowledge graph/mind map generator." },
        { role: "user", content: prompt }
      ],
      response_format: { type: "json_object" },
      max_tokens: 2000,
      temperature: 0.3
    });

    const choice = completion.choices[0];
    const content = choice?.message?.content;
    const finishReason = choice?.finish_reason;

    console.log("Raw GPT response:", content);
    console.log("Finish reason:", finishReason);

    let json = null;
    try {
      json = typeof content === "string" ? JSON.parse(content) : content;
    } catch (e) {
      console.error("JSON parse error:", e);
      // Detect if the model was truncated
      if (finishReason === "length") {
        return res.status(200).json({
          nodes: [],
          edges: [],
          error: "LLM output was truncated (finish_reason: 'length'). Try reducing the scope or number of nodes.",
          details: e.message,
          gpt_response: content
        });
      }
      return res.status(200).json({
        nodes: [],
        edges: [],
        error: "LLM output parse error",
        details: e.message,
        gpt_response: content
      });
    }
    res.status(200).json(json);
  } catch (err) {
    console.error("OpenAI API error:", err);
    res.status(500).json({ error: "OpenAI API error", details: err?.message });
  }
}
