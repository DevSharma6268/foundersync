"use client"

import type React from "react"
import { useCallback, useEffect, useRef, useState } from "react"
import Link from "next/link"
import { useParams } from "next/navigation"
import { ArrowLeft, Clock, Loader2, MessageSquare, Send, Users } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import {
  Target,
  Code,
  Palette,
  TrendingUp,
  BarChart3,
  User,
} from "lucide-react"

type AgentId = "ceo" | "cto" | "pm" | "designer" | "marketing"

interface AgentMeta {
  id: AgentId
  name: string
  role: string
  color: string
  icon: React.ComponentType<{ className?: string }>
}

const AGENTS: AgentMeta[] = [
  { id: "ceo", name: "Alex Chen", role: "CEO", color: "bg-blue-500", icon: Target },
  { id: "cto", name: "Sarah Kim", role: "CTO", color: "bg-green-500", icon: Code },
  { id: "pm", name: "Mike Johnson", role: "Product Manager", color: "bg-purple-500", icon: BarChart3 },
  { id: "designer", name: "Emma Davis", role: "Designer", color: "bg-pink-500", icon: Palette },
  { id: "marketing", name: "Jordan Lee", role: "Marketing Lead", color: "bg-orange-500", icon: TrendingUp },
]

interface ChatMessage {
  key: string
  role: "user" | "assistant"
  content: string
  timestamp: Date
  agentId?: AgentId
  emotion?: string
  tone?: string
}

function getAccessToken(): string | null {
  try {
    const storageKey = Object.keys(localStorage).find((k) => k.startsWith("sb-") && k.endsWith("-auth-token")) || ""
    const authData = localStorage.getItem(storageKey)
    if (!authData) return null
    const parsed = JSON.parse(authData) as { access_token?: string }
    return parsed.access_token ?? null
  } catch {
    return null
  }
}

function simulationIdFromParams(id: string | string[] | undefined): string | null {
  if (typeof id === "string") return id
  if (Array.isArray(id)) return id[0] ?? null
  return null
}

export default function TeamRoomPage() {
  const params = useParams()
  const sid = simulationIdFromParams(params?.id)
  const scrollRef = useRef<HTMLDivElement>(null)

  const [startupName, setStartupName] = useState("")
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState("")
  const [replyAs, setReplyAs] = useState<"" | AgentId>("")
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)

  const scrollToBottom = () => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }

  const loadThread = useCallback(async () => {
    if (!sid) return
    const token = getAccessToken()
    if (!token) {
      toast.error("Please sign in to continue")
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const res = await fetch(`/api/simulate/${sid}/team-room`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(data.error || "Failed to load team room")
      }
      setStartupName(data.simulation?.startup_name ?? "Simulation")

      const rows = data.entries as Array<{
        id: string
        agent_name: string
        user_message: string
        agent_response: { message: string; emotion?: string; tone?: string }
        created_at: string
      }>

      const next: ChatMessage[] = []
      for (const row of rows || []) {
        next.push({
          key: `${row.id}-u`,
          role: "user",
          content: row.user_message,
          timestamp: new Date(row.created_at),
        })
        const aid = row.agent_name as AgentId
        next.push({
          key: `${row.id}-a`,
          role: "assistant",
          content: row.agent_response.message,
          timestamp: new Date(row.created_at),
          agentId: AGENTS.some((a) => a.id === aid) ? aid : "ceo",
          emotion: row.agent_response.emotion,
          tone: row.agent_response.tone,
        })
      }
      setMessages(next)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load team room")
    } finally {
      setLoading(false)
    }
  }, [sid])

  useEffect(() => {
    void loadThread()
  }, [loadThread])

  useEffect(() => {
    scrollToBottom()
  }, [messages])

  const send = async () => {
    const text = input.trim()
    if (!text || !sid || sending) return
    const token = getAccessToken()
    if (!token) {
      toast.error("Please sign in to continue")
      return
    }

    const optimisticUser: ChatMessage = {
      key: `pending-u-${Date.now()}`,
      role: "user",
      content: text,
      timestamp: new Date(),
    }
    setMessages((m) => [...m, optimisticUser])
    setInput("")
    setSending(true)

    try {
      const res = await fetch(`/api/simulate/${sid}/team-room`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          message: text,
          ...(replyAs ? { replyAs } : {}),
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(data.details || data.error || "Failed to send")
      }

      await loadThread()
    } catch (e) {
      setMessages((m) => m.filter((x) => x.key !== optimisticUser.key))
      setInput(text)
      toast.error(e instanceof Error ? e.message : "Failed to send")
    } finally {
      setSending(false)
    }
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      void send()
    }
  }

  const metaFor = (id: AgentId | undefined) => (id ? AGENTS.find((a) => a.id === id) : undefined)

  if (!sid) {
    return (
      <div className="p-8">
        <p className="text-muted-foreground">Invalid simulation.</p>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <header className="border-b bg-card/80 backdrop-blur sticky top-0 z-10">
        <div className="max-w-3xl mx-auto flex items-center gap-3 px-4 py-3">
          <Button variant="ghost" size="icon" asChild>
            <Link href={`/dashboard/simulation/${sid}`} aria-label="Back to simulation">
              <ArrowLeft className="h-5 w-5" />
            </Link>
          </Button>
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-600 text-white">
            <Users className="h-4 w-4" />
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="text-lg font-semibold truncate">Team room</h1>
            <p className="text-xs text-muted-foreground truncate">{startupName}</p>
          </div>
        </div>
      </header>

      <div className="flex-1 max-w-3xl w-full mx-auto flex flex-col px-4 py-4 gap-4">
        <Card className="border-dashed">
          <CardContent className="p-4 text-sm text-muted-foreground">
            <p className="mb-2">
              Messages here are answered by <strong className="text-foreground">one teammate at a time</strong>, using
              their name and role. The app picks who fits best from what you write (or you can choose below).
            </p>
            <p>Tip: mention a role or name (e.g. &quot;Sarah, what about our API?&quot;) to route to that person.</p>
          </CardContent>
        </Card>

        <div className="flex flex-wrap gap-2 items-center text-sm">
          <span className="text-muted-foreground shrink-0">Reply as:</span>
          <select
            className="h-9 rounded-md border border-input bg-background px-2 text-sm min-w-[200px]"
            value={replyAs}
            onChange={(e) => setReplyAs((e.target.value || "") as "" | AgentId)}
            disabled={sending}
          >
            <option value="">Auto — best teammate</option>
            {AGENTS.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} ({a.role})
              </option>
            ))}
          </select>
        </div>

        <Card className="flex-1 flex flex-col min-h-[50vh] overflow-hidden">
          <CardContent className="p-0 flex flex-col flex-1 min-h-0">
            <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-4">
              {loading ? (
                <div className="flex justify-center py-16 text-muted-foreground">
                  <Loader2 className="h-8 w-8 animate-spin" />
                </div>
              ) : messages.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-center text-muted-foreground">
                  <MessageSquare className="h-10 w-10 mb-3 opacity-50" />
                  <p className="font-medium text-foreground">No messages yet</p>
                  <p className="text-sm max-w-sm mt-1">Say hi or ask a question — the right teammate will answer with their name.</p>
                </div>
              ) : (
                messages.map((msg) => {
                  const agent = msg.role === "assistant" ? metaFor(msg.agentId) : undefined
                  const Icon = msg.role === "user" ? User : agent?.icon
                  return (
                    <div
                      key={msg.key}
                      className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                    >
                      <div
                        className={`max-w-[88%] rounded-2xl px-4 py-3 ${
                          msg.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted"
                        }`}
                      >
                        <div className="flex items-center gap-2 mb-2">
                          <Avatar className="h-6 w-6">
                            <AvatarImage src="/placeholder.svg" />
                            <AvatarFallback className={msg.role === "user" ? "bg-slate-600" : agent?.color ?? "bg-muted"}>
                              {Icon ? <Icon className="h-3 w-3 text-white" /> : null}
                            </AvatarFallback>
                          </Avatar>
                          <span className="text-xs font-medium">
                            {msg.role === "user"
                              ? "You"
                              : agent
                                ? `${agent.name} · ${agent.role}`
                                : "Teammate"}
                          </span>
                          {msg.role === "assistant" && msg.agentId && (
                            <Badge variant="outline" className="text-[10px] h-5 px-1.5">
                              {msg.agentId}
                            </Badge>
                          )}
                        </div>
                        <p className="text-sm leading-relaxed whitespace-pre-wrap">{msg.content}</p>
                        <div className="flex items-center gap-2 mt-2 text-[10px] opacity-70">
                          <Clock className="h-3 w-3" />
                          <span>
                            {msg.timestamp.toLocaleString("en-US", {
                              hour: "numeric",
                              minute: "2-digit",
                              month: "short",
                              day: "numeric",
                            })}
                          </span>
                          {msg.tone ? <span>· {msg.tone}</span> : null}
                        </div>
                      </div>
                    </div>
                  )
                })
              )}
            </div>

            <div className="border-t p-3 flex gap-2">
              <Input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={onKeyDown}
                placeholder="Ask the team… (who answers depends on your message)"
                disabled={sending}
                className="h-11"
              />
              <Button className="h-11 px-5 shrink-0" onClick={() => void send()} disabled={sending || !input.trim()}>
                {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
