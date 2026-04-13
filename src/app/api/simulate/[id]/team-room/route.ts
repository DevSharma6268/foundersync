import { NextResponse } from "next/server"
import { createServerSupabaseClient } from "@/lib/supabase-server"
import { agentResponseWithThread, isTeamRoomRow, THREAD_TEAM_ROOM } from "@/lib/conversation-thread"
import { classifyTeamRoomResponder, generateAgentResponse, TEAM_ROOM_AGENT_IDS, type TeamRoomAgentId } from "@/lib/gemini"

function isTeamRoomAgentId(id: string | undefined | null): id is TeamRoomAgentId {
    return !!id && TEAM_ROOM_AGENT_IDS.includes(id as TeamRoomAgentId)
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
    try {
        const { id: simulationId } = await params
        const accessToken = request.headers.get("Authorization")?.split("Bearer ")[1]
        if (!accessToken) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
        }

        const supabase = createServerSupabaseClient(accessToken)

        const { data: simulation, error: simError } = await supabase
            .from("simulations")
            .select("*")
            .eq("id", simulationId)
            .single()

        if (simError || !simulation) {
            return NextResponse.json({ error: "Simulation not found" }, { status: 404 })
        }

        const { data: allRows, error: convError } = await supabase
            .from("conversations")
            .select("id, agent_name, user_message, agent_response, created_at")
            .eq("simulation_id", simulationId)
            .order("created_at", { ascending: true })

        if (convError) {
            console.error("team-room GET:", convError)
            return NextResponse.json({ error: "Failed to load team room" }, { status: 500 })
        }

        const rows = (allRows ?? []).filter(isTeamRoomRow)

        return NextResponse.json({
            simulation,
            entries: rows,
        })
    } catch (error) {
        console.error("team-room GET:", error)
        return NextResponse.json({ error: "Internal server error" }, { status: 500 })
    }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
    try {
        const { id: simulationId } = await params
        const body = await request.json()
        const message = typeof body.message === "string" ? body.message.trim() : ""
        const replyAsRaw = typeof body.replyAs === "string" ? body.replyAs.trim().toLowerCase() : ""

        if (!message) {
            return NextResponse.json({ error: "Message is required" }, { status: 400 })
        }

        const accessToken = request.headers.get("Authorization")?.split("Bearer ")[1]
        if (!accessToken) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
        }

        if (!process.env.GEMINI_API_KEY) {
            return NextResponse.json({ error: "AI not configured" }, { status: 500 })
        }

        const supabase = createServerSupabaseClient(accessToken)

        const { data: simulation, error: simError } = await supabase
            .from("simulations")
            .select("*")
            .eq("id", simulationId)
            .single()

        if (simError || !simulation) {
            return NextResponse.json({ error: "Simulation not found" }, { status: 404 })
        }

        const respondingAgent: TeamRoomAgentId = isTeamRoomAgentId(replyAsRaw)
            ? replyAsRaw
            : await classifyTeamRoomResponder(message)

        const { data: recentRows, error: histError } = await supabase
            .from("conversations")
            .select("agent_name, user_message, agent_response, created_at")
            .eq("simulation_id", simulationId)
            .order("created_at", { ascending: false })
            .limit(120)

        if (histError) {
            console.error("team-room history:", histError)
            return NextResponse.json({ error: "Failed to load history" }, { status: 500 })
        }

        const teamHistory = (recentRows ?? [])
            .filter(isTeamRoomRow)
            .slice(0, 25)
            .reverse()

        const historyForModel =
            teamHistory.map((conv) => ({
                role: "user" as const,
                content: conv.user_message,
                response: conv.agent_response.message,
                timestamp: conv.created_at,
                agent_name: conv.agent_name,
            })) ?? []

        const response = await generateAgentResponse(respondingAgent, message, {
            startupName: simulation.startup_name,
            description: simulation.description,
            industry: simulation.industry,
            conversationHistory: historyForModel,
            teamRoomReply: true,
        })

        const { error: saveError } = await supabase.from("conversations").insert([
            {
                simulation_id: simulationId,
                agent_name: respondingAgent,
                user_message: message,
                agent_response: agentResponseWithThread(response, THREAD_TEAM_ROOM),
            },
        ])

        if (saveError) {
            console.error("team-room save:", saveError)
            return NextResponse.json({ error: "Failed to save message", details: saveError.message }, { status: 500 })
        }

        return NextResponse.json({
            response,
            respondingAgent,
        })
    } catch (error) {
        console.error("team-room POST:", error)
        return NextResponse.json(
            { error: "Failed to process team room message", details: error instanceof Error ? error.message : "Unknown" },
            { status: 500 }
        )
    }
}
