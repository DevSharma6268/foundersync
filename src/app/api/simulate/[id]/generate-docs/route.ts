import { NextResponse } from "next/server"
import { createServerSupabaseClient } from "@/lib/supabase-server"
import { generateAgentResponse } from "@/lib/gemini"

interface GenerationContext {
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
}


export async function POST(request: Request, { params }: { params: { id: string } }) {
    try {
        const simulationId = params.id;
        const accessToken = request.headers.get("Authorization")?.split("Bearer ")[1];

        if (!accessToken) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const supabase = createServerSupabaseClient(accessToken);

        // Get simulation details
        const { data: simulation, error: simError } = await supabase
            .from('simulations')
            .select('*')
            .eq('id', simulationId)
            .single();

        if (simError) {
            console.error("Error fetching simulation:", simError);
            return NextResponse.json({ error: "Simulation not found" }, { status: 404 });
        }

        // Get ALL conversations for this simulation
        const { data: conversations, error: convError } = await supabase
            .from('conversations')
            .select('*')
            .eq('simulation_id', simulationId)
            .order('created_at', { ascending: true });

        if (convError) {
            console.error("Error fetching conversations:", convError);
            return NextResponse.json({ error: "Failed to load conversations" }, { status: 500 });
        }

        // Context for AI generation
        const context = {
            startupName: simulation.startup_name,
            description: simulation.description,
            industry: simulation.industry,
            conversationHistory: conversations.map(conv => ({
                role: "user",
                content: conv.user_message,
                response: conv.agent_response.message,
                timestamp: conv.created_at,
                agent_name: conv.agent_name
            }))
        };

        const comprehensivePrompt = `
You are the Lead Technical Writer for ${context.startupName}. Generate a comprehensive Feature Development Documentation in Markdown format.

The document MUST cover the following 5 topics:
1. AI Monitoring System Enhancement
2. User Experience Improvements
3. Performance Optimization
4. Security Enhancements
5. Integration Capabilities

For EACH of the 5 topics, provide a 1-2 sentence perspective from each of the following team members.
Format the output strictly in Markdown. Use single asterisks for bolding. Use ### for agent perspectives.

Start directly with the topics (no introduction paragraph).
`;
        
        let generatedMarkdown = "Documentation generation failed.";
        try {
            const GEMINI_API_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent";
            const reqResponse = await fetch(`${GEMINI_API_ENDPOINT}?key=${process.env.GEMINI_API_KEY}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{
                        parts: [{
                            text: "Context: " + JSON.stringify(context) + "\n\n" + comprehensivePrompt
                        }]
                    }],
                    generationConfig: { temperature: 0.7, maxOutputTokens: 8192 }
                })
            });
            
            if (!reqResponse.ok) {
                throw new Error(`API Error: ${reqResponse.status} ${reqResponse.statusText}`);
            }
            
            const data = await reqResponse.json();
            if (data.candidates && data.candidates[0].content && data.candidates[0].content.parts[0].text) {
                generatedMarkdown = data.candidates[0].content.parts[0].text;
            } else {
                throw new Error("Invalid response structure from Gemini");
            }
        } catch (aiError) {
            console.error("Documentation generation failed:", aiError);
            generatedMarkdown = `Documentation generation failed due to API Error: ${aiError instanceof Error ? aiError.message : "Unknown error"}`;
        }

        const fullDocumentation = `# ${context.startupName} - Feature Development Documentation

## Overview
This document outlines various perspectives from the team on key feature developments and improvements.

${generatedMarkdown}

## Summary
This collaborative document represents the combined insights of the entire team, ensuring a comprehensive approach to our development initiatives.

Generated on: ${new Date().toLocaleString()}
`;

        // Store the documentation in the database
        const { error: docError } = await supabase
            .from('documentation')
            .insert([
                {
                    simulation_id: simulationId,
                    content: fullDocumentation,
                    generated_at: new Date().toISOString(),
                    metadata: {
                        tone: "professional",
                        emotion: "confident",
                        context: {
                            startup_name: simulation.startup_name,
                            industry: simulation.industry,
                            description: simulation.description
                        }
                    }
                }
            ]);

        if (docError) {
            console.error("Error saving documentation:", docError);
            return NextResponse.json({ error: "Failed to save documentation" }, { status: 500 });
        }

        return NextResponse.json({
            documentation: fullDocumentation,
            metadata: {
                tone: "professional",
                emotion: "confident",
                generated_at: new Date().toISOString()
            }
        });

    } catch (error) {
        console.error("Error generating documentation:", error);
        return NextResponse.json({
            error: "Failed to generate documentation",
            details: error instanceof Error ? error.message : "Unknown error"
        }, { status: 500 });
    }
} 