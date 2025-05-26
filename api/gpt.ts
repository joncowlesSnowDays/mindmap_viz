import type { VercelRequest, VercelResponse } from "@vercel/node";
import OpenAI from "openai";

// Secure OpenAI key from env
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

function buildInfoPrompt(nodeId: string, nodeLabel: string, childLabels: string[] = []) {
  return `
Generate a detailed paragraph about "${nodeLabel}". 
${childLabels.length > 0 ? `Include how it relates to its subtopics: ${childLabels.join(", ")}.` : ""}
Focus on providing insightful, accurate, and well-structured information.
Keep the response concise but informative (2-4 sentences).
`.trim();
}

function buildPrompt(userQuery: string, mindMapContext: any, selectedNodeId?: string | null) {
  if (!selectedNodeId) {
    // NEW mind map creation
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
  ],
  "edges": [
    { "id": "e-root-child1", "source": "root", "target": "child1", "type": "informs" }
  ]
}
Do NOT return grandchildren (only one layer of children).
Do NOT include extra text, comments, or explanations. Only valid JSON.
    `.trim();
  } else {
    // PARTIAL EXPANSION: ONLY the selected node gets new children.
    return `
You are an AI mind map builder.
Expand ONLY the selected node with id "${selectedNodeId}" from the mind map below:

${JSON.stringify(mindMapContext, null, 2)}

- Generate 3-6 new direct children (meaningful subtopics or key aspects) for the selected node.
- Only output NEW nodes and NEW edges; DO NOT include any nodes or edges that already exist in the mind map context.
- All IDs must be unique and must not conflict with existing IDs in the context.
- For each new child node, set "preview": true if you want it to be expandable by the user later.
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
**IMPORTANT: Do NOT return the full map—only new nodes and new edges that do not duplicate any from the context.**
Do NOT include comments or extra text—only valid JSON.
If you generate no new nodes, return empty arrays for nodes and edges.
    `.trim();
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === "POST" && req.body.type === "getInfo") {
    console.log('Handling getInfo request:', req.body);
    const { nodeId, nodeLabel, childLabels } = req.body;
    const prompt = buildInfoPrompt(nodeId, nodeLabel, childLabels);
    
    try {
      const completion = await openai.chat.completions.create({
        model: "gpt-4",
        messages: [
          { role: "system", content: "You are an expert at explaining concepts clearly and concisely." },
          { role: "user", content: prompt }
        ],
        max_tokens: 200,
        temperature: 0.7
      });

      const content = completion.choices[0]?.message?.content;
      console.log('Generated info content:', content);
      res.status(200).json({ content });
      return;
    } catch (err) {
      console.error("OpenAI API error:", err);
      res.status(500).json({ error: "OpenAI API error", details: err?.message });
      return;
    }
  }

  // Handle regular mind map expansion
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
      model: "gpt-4",
      messages: [
        { role: "system", content: "You are an expert knowledge graph/mind map generator." },
        { role: "user", content: prompt }
      ],
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
