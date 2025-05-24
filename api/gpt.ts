import type { VercelRequest, VercelResponse } from "@vercel/node";
import OpenAI from "openai";

// Secure OpenAI key from env
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

// Compose a prompt for GPT, including current map context
function buildPrompt(userQuery: string, mindMapContext: any) {
  return `
You are an AI knowledge map builder. The user will ask a question and provide the current mind map (nodes, edges, groups).
Your job is to return an updated set of concepts and relationships in JSON, expanding the selected topic with **two new layers** of children.

Output must be valid, parseable JSON that matches the shape below:

Example Output:
{
  "nodes": [
    { "id": "root", "label": "Main Topic", "group": "Group A", "type": "concept", "preview": false, "collapsed": false },
    { "id": "child1", "label": "Subtopic 1", "group": "Group A", "type": "concept", "preview": false, "collapsed": false },
    { "id": "child2", "label": "Subtopic 2", "group": "Group A", "type": "concept", "preview": true, "collapsed": false }
  ],
  "edges": [
    { "id": "e-root-child1", "source": "root", "target": "child1", "type": "informs" },
    { "id": "e-root-child2", "source": "root", "target": "child2", "type": "depends on" }
  ]
}

**Your Task:**
- Find the node that best matches the user's query or is selected for expansion.
- For that node:
  - Generate 4-8 direct children (Layer 1), each a meaningful subtopic or key aspect.
  - For each child, generate 2-4 children of their own (Layer 2), as sub-aspects, examples, or further breakdowns.
- If any of these should be "preview" nodes (for future expansion), set "preview": true.
- Make sure all nodes have unique "id", "label", and belong to a logical "group" if appropriate.

**Node and Edge Structure:**
- "group" clusters related concepts visually.
- "type" in edges is one of: "informs", "depends on", "related".
- "preview" nodes are semi-transparent, for user expansion.
- Avoid duplicating nodes already present in the mind map.
- Place new nodes in clear, logical relationships, minimizing clutter.

**Rules:**
- Expand only the node relevant to the user query by two layers.
- Do **not** connect nodes in Layer 2 directly to the root node unless logically necessary.
- Do not include comments or extra text—only valid JSON.
- Double-check for missing commas, mismatched quotes, or unclosed braces before returning.
- Use unique, stable IDs (don’t re-use IDs of existing nodes unless updating).
- Try to maximize visual clarity.

**Current mind map (context):**
${JSON.stringify(mindMapContext)}

**User query:** "${userQuery}"

Return only the updated mind map JSON.
  `;
}



export default async function handler(req, res) {
  const { userQuery, mindMapContext } = req.body;
  const prompt = buildPrompt(userQuery, mindMapContext);

  // --- Debug logs start ---
  console.log("API key:", process.env.OPENAI_API_KEY ? "present" : "missing");
  console.log("userQuery:", userQuery);
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
      max_tokens: 3000,
      temperature: 0.3
    });

    // --- Log the raw GPT content ---
    const content = completion.choices[0]?.message?.content;
    console.log("Raw GPT response:", content);

    let json = null;
    try {
      json = typeof content === "string" ? JSON.parse(content) : content;
    } catch (e) {
      // Enhanced error logging with the problematic content and error details
      console.error("JSON parse error:", e);
      console.error("Problematic GPT response:", content);
      return res.status(200).json({ nodes: [], edges: [], error: "LLM output parse error", details: e.message, gpt_response: content });
    }
    res.status(200).json(json);
  } catch (err) {
    console.error("OpenAI API error:", err);
    res.status(500).json({ error: "OpenAI API error", details: err?.message });
  }
}

