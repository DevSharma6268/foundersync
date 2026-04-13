/** Stored on each row inside `agent_response` jsonb — no DB migration required */
export const THREAD_DIRECT = "direct" as const
export const THREAD_TEAM_ROOM = "team_room" as const

export type ConversationThread = typeof THREAD_DIRECT | typeof THREAD_TEAM_ROOM

export type AgentResponsePayload = {
    message: string
    tone: string
    emotion: string
    _thread?: string
}

export function agentResponseWithThread(
    response: { message: string; tone: string; emotion: string },
    thread: ConversationThread
): AgentResponsePayload {
    return { ...response, _thread: thread }
}

export function isTeamRoomRow(row: { agent_response?: unknown }): boolean {
    const ar = row.agent_response as AgentResponsePayload | undefined
    return ar?._thread === THREAD_TEAM_ROOM
}

export function isDirectThreadRow(row: { agent_response?: unknown }): boolean {
    return !isTeamRoomRow(row)
}
