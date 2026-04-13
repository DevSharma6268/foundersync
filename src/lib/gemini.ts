// Add detailed logging for missing API key
if (!process.env.GEMINI_API_KEY) {
    console.error("CRITICAL ERROR: GEMINI_API_KEY is not configured in environment variables");
    console.error("Please ensure you have created a .env.local file with GEMINI_API_KEY=your_api_key_here");
    throw new Error("Missing GEMINI_API_KEY environment variable");
}
const GEMINI_API_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent";
interface ConversationContext {
    startupName: string;
    description: string;
    industry: string;
    conversationHistory: Array<{
        role: string;
        content: string;
        response: string;
        timestamp: string;
        agent_name: string;
    }>;
    /** Shared team room: answer only as this role, not as other teammates */
    teamRoomReply?: boolean;
}

export const TEAM_ROOM_AGENT_IDS = ["ceo", "cto", "pm", "designer", "marketing"] as const
export type TeamRoomAgentId = (typeof TEAM_ROOM_AGENT_IDS)[number]

export async function classifyTeamRoomResponder(userMessage: string): Promise<TeamRoomAgentId> {
    const prompt = `You route a founder's message in a startup team chat to exactly ONE teammate who should answer.

Teammates (use ONLY these lowercase ids):
- ceo — Alex Chen, CEO: strategy, vision, fundraising, business model, leadership
- cto — Sarah Kim, CTO: engineering, architecture, infra, security, APIs, stack
- pm — Mike Johnson, Product Manager: roadmap, prioritization, users, requirements, metrics
- designer — Emma Davis, Designer: UX, UI, design system, branding, research
- marketing — Jordan Lee, Marketing: GTM, growth, messaging, ads, positioning

Rules:
- If the user names, @mentions, or clearly addresses one person or role (e.g. "Sarah", "CTO", "design"), pick that id.
- Match topic to expertise (e.g. "landing page copy" → marketing; "database" → cto; "wireframe" → designer).
- If still unclear, pick ceo.

User message:
${JSON.stringify(userMessage)}

Reply with ONLY valid JSON: {"agent":"cto"}
No markdown, no extra text.`

    const response = await fetch(`${GEMINI_API_ENDPOINT}?key=${process.env.GEMINI_API_KEY}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0.2, maxOutputTokens: 256 },
        }),
    })

    if (!response.ok) {
        console.warn("classifyTeamRoomResponder: API error, defaulting to ceo")
        return "ceo"
    }

    const data = await response.json()
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text
    if (!text || typeof text !== "string") {
        return "ceo"
    }

    let cleaned = text.trim().replace(/^```json\s*/, "").replace(/^```\s*/, "").replace(/\s*```$/, "")
    try {
        const parsed = JSON.parse(cleaned) as { agent?: string }
        const id = parsed.agent?.toLowerCase().trim()
        if (id && TEAM_ROOM_AGENT_IDS.includes(id as TeamRoomAgentId)) {
            return id as TeamRoomAgentId
        }
    } catch {
        /* fall through */
    }
    return "ceo"
}

export async function generateAgentResponse(
    agentName: string,
    userMessage: string,
    context: ConversationContext,
    onChunk?: (chunk: string) => void
) {
    try {
        const roleContext = getRoleSpecificContext(agentName);
        const roleTitle = `${agentName.toUpperCase()} of ${context.startupName}`;

        const prompt = `You are the ${roleTitle}, a startup in the ${context.industry} industry.

The startup's description is: ${context.description}

Your role and expertise: ${roleContext.description}

Previous conversations in chronological order:
${context.conversationHistory.map(msg =>
            `${msg.agent_name.toUpperCase()}: User asked: ${msg.content}\n${msg.agent_name.toUpperCase()} responded: ${msg.response}`
        ).join("\n\n")}

User's question: ${userMessage}

${context.teamRoomReply ? "You are posting in the shared team room under YOUR name and role only. Do not impersonate or quote other teammates speaking; give your own view.\n\n" : ""}IMPORTANT INSTRUCTIONS:
1. Respond as the ${agentName.toUpperCase()} role, maintaining character and expertise
2. Keep responses concise and focused (5-6 sentences max)
3. Be direct and actionable in your advice
4. Use natural, conversational language
5. Focus on your specific area of expertise: ${roleContext.expertise}
6. Consider the context of ALL previous conversations, including those with other agents
7. CRITICAL: Your response MUST be a valid JSON object with the following structure:
{
    "message": "Your concise response here",
    "tone": "confident/thoughtful/analytical/etc",
    "emotion": "neutral/excited/concerned/etc"
}
8. Do not include any text before or after the JSON object
9. Ensure the response is properly escaped JSON`;

        console.log(`Generating response for ${agentName} to: ${userMessage}`);

        const response = await fetch(`${GEMINI_API_ENDPOINT}?key=${process.env.GEMINI_API_KEY}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                contents: [{
                    parts: [{
                        text: prompt
                    }]
                }],
                generationConfig: {
                    temperature: 0.7,
                    topK: 40,
                    topP: 0.95,
                    maxOutputTokens: 8192,
                }
            })
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => null);
            console.error("Gemini API Error Response:", {
                status: response.status,
                statusText: response.statusText,
                errorData
            });
            throw new Error(`Gemini API error: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();

        if (!data.candidates?.[0]?.content?.parts?.[0]?.text) {
            console.error("Unexpected Gemini API response format:", data);
            throw new Error("Invalid response format from Gemini API");
        }

        let content = data.candidates[0].content.parts[0].text;

        // Clean up the response to ensure it's valid JSON
        content = content.trim();

        // Remove any markdown code block markers if present
        content = content.replace(/^```json\s*/, '').replace(/^```\s*/, '').replace(/\s*```$/, '');

        try {
            // Parse the JSON response
            const parsedResponse = JSON.parse(content);

            // Validate the response structure
            if (!parsedResponse.message || !parsedResponse.tone || !parsedResponse.emotion) {
                throw new Error("Invalid response structure: missing required fields");
            }

            // If we have a streaming callback, simulate streaming with chunks
            if (onChunk) {
                const words = parsedResponse.message.split(' ');
                for (const word of words) {
                    await onChunk(word + ' ');
                    // Add a small delay between words
                    await new Promise(resolve => setTimeout(resolve, 100));
                }
            }

            return parsedResponse;

        } catch (parseError: Error | unknown) {
            console.error("JSON Parse Error:", {
                error: parseError instanceof Error ? parseError.message : "Unknown parsing error",
                content: content
            });
            throw new Error(`Failed to parse AI response as JSON: ${parseError instanceof Error ? parseError.message : "Unknown parsing error"}`);
        }

    } catch (error: Error | unknown) {
        console.error("Error in generateAgentResponse:", {
            error: error instanceof Error ? {
                message: error.message,
                name: error.name,
                stack: error.stack
            } : error,
            agentName,
            userMessage
        });
        throw error;
    }
}

function getRoleSpecificContext(role: string) {
    const contexts = {
        ceo: {
            description: "As CEO, you provide strategic vision, business model insights, and high-level direction for the startup.",
            expertise: "business strategy, leadership, market positioning, fundraising, and overall company vision"
        },
        cto: {
            description: "As CTO, you handle technical architecture, development strategy, and technology decisions.",
            expertise: "technical architecture, development processes, technology stack selection, and engineering team management"
        },
        pm: {
            description: "As Product Manager, you focus on product strategy, user needs, and feature prioritization.",
            expertise: "product roadmap, user experience, feature prioritization, and market requirements"
        },
        designer: {
            description: "As Designer, you handle user interface, user experience, and overall design strategy.",
            expertise: "UI/UX design, brand identity, user research, and design systems"
        },
        marketing: {
            description: "As Marketing Lead, you develop marketing strategy, growth plans, and brand positioning.",
            expertise: "marketing strategy, brand development, customer acquisition, and growth tactics"
        }
    };

    return contexts[role as keyof typeof contexts] || contexts.ceo;
}