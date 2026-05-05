import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ArrowLeft, Pause, Play, Trash2, RotateCw, Repeat, AlertTriangle, ExternalLink, Copy, Check, Square, RefreshCw, Music, Play as PlayIcon, ListChecks } from "lucide-react";
import { toast } from "sonner";
import { stopSpeech } from "@/lib/speech";
import { EditPromptRunDialog, EditPromptMode } from "@/components/EditPromptRunDialog";

type Attachments = {
  sources: { url: string; type: "image" | "video" }[];
  contextChecklists: { id: string; title: string }[];
  contextMedia: { url: string; type: "image" | "video" | "audio"; name: string }[];
};

type Job = {
  id: string;
  user_id: string;
  checklist_id: string;
  source_item_id: string | null;
  action_type: string;
  status: "pending" | "scheduled" | "running" | "awaiting_provider" | "completed" | "failed" | "paused" | "cancelled";
  prompt_preview: string | null;
  error_raw: string | null;
  error_friendly: string | null;
  error_fix: string | null;
  scheduled_for: string | null;
  recurrence: string | null;
  attempts: number;
  max_attempts: number;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  parent_job_id: string | null;
  sequence_step: number | null;
  provider: string | null;
  provider_polled_at: string | null;
  attachments: Attachments;
};

// Payloads are bounded to <=200KB by enqueue-action; safe to fetch for the dashboard.
const JOB_COLS = "id,user_id,checklist_id,source_item_id,action_type,status,prompt_preview,error_raw,error_friendly,error_fix,scheduled_for,recurrence,attempts,max_attempts,created_at,started_at,completed_at,parent_job_id,sequence_step,provider,provider_polled_at,payload";

const isHttpUrl = (u: unknown): u is string =>
  typeof u === "string" && (u.startsWith("http://") || u.startsWith("https://"));

const deriveAttachments = (action_type: string, payload: any): Attachments => {
  const sources: Attachments["sources"] = [];
  const p = payload ?? {};

  // Source/reference media (gallery URLs only — skip legacy data URLs).
  if (Array.isArray(p.refImageUrls)) {
    for (const u of p.refImageUrls) if (isHttpUrl(u)) sources.push({ url: u, type: "image" });
  }
  if (isHttpUrl(p.sourceUrl)) {
    const t: "image" | "video" = action_type === "video-video" ? "video" : "image";
    sources.push({ url: p.sourceUrl, type: t });
  }
  if (isHttpUrl(p.imageUrl)) {
    sources.push({ url: p.imageUrl, type: "image" });
  }

  const ctx = p.context ?? {};
  const contextChecklists = Array.isArray(ctx.checklists)
    ? ctx.checklists
        .filter((c: any) => c && typeof c.id === "string")
        .map((c: any) => ({ id: c.id, title: typeof c.title === "string" ? c.title : "Untitled" }))
    : [];
  const contextMedia = Array.isArray(ctx.media)
    ? ctx.media
        .filter((m: any) => m && isHttpUrl(m.url) && (m.type === "image" || m.type === "video" || m.type === "audio"))
        .map((m: any) => ({ url: m.url, type: m.type, name: typeof m.name === "string" ? m.name : "" }))
    : [];

  return { sources, contextChecklists, contextMedia };
};

const ACTION_LABELS: Record<string, string> = {
  "text-text": "Text to text",
  "text-image": "Text to image",
  "image-image": "Image to image",
  "remix": "Remix images",
  "image-video": "Image to video",
  "video-video": "Video to video",
  "audio-image-video": "Audio + image to video",
  "analyze-image": "Analyze image",
  "web-search": "Web search",
  "action-sequence": "Action Sequence",
};

const fmt = (iso: string | null) => {
  if (!iso) return "";
  try { return new Date(iso).toLocaleString(); } catch { return iso; }
};

const STATUS_LABELS: Record<Job["status"], string> = {
  pending: "pending",
  scheduled: "scheduled",
  running: "running",
  awaiting_provider: "awaiting provider",
  completed: "completed",
  failed: "failed",
  paused: "paused",
  cancelled: "cancelled",
};

const StatusBadge = ({ s }: { s: Job["status"] }) => {
  const map: Record<Job["status"], string> = {
    pending: "bg-muted text-foreground",
    scheduled: "bg-blue-500/15 text-blue-700 dark:text-blue-300",
    running: "bg-amber-500/15 text-amber-700 dark:text-amber-300 animate-pulse",
    awaiting_provider: "bg-purple-500/15 text-purple-700 dark:text-purple-300 animate-pulse",
    completed: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
    failed: "bg-destructive/15 text-destructive",
    paused: "bg-muted text-muted-foreground",
    cancelled: "bg-muted text-muted-foreground line-through",
  };
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${map[s]}`}>{STATUS_LABELS[s]}</span>;
};

type Thumb = { url: string; type: "image" | "video" | "audio"; name?: string; label: string };

const MediaThumb = ({ t }: { t: Thumb }) => {
  const common = "block h-14 w-14 rounded-md overflow-hidden border border-border bg-muted shrink-0 relative";
  if (t.type === "image") {
    return (
      <a href={t.url} target="_blank" rel="noreferrer" className={common} aria-label={t.label} title={t.name || t.label}>
        <img src={t.url} alt={t.name || t.label} loading="lazy" className="h-full w-full object-cover" />
      </a>
    );
  }
  if (t.type === "video") {
    return (
      <a href={t.url} target="_blank" rel="noreferrer" className={common} aria-label={t.label} title={t.name || t.label}>
        <video src={t.url} muted preload="metadata" className="h-full w-full object-cover" />
        <span className="absolute inset-0 flex items-center justify-center bg-black/30">
          <PlayIcon className="h-5 w-5 text-white" />
        </span>
      </a>
    );
  }
  return (
    <a href={t.url} target="_blank" rel="noreferrer" className={`${common} flex flex-col items-center justify-center p-1`} aria-label={t.label} title={t.name || t.label}>
      <Music className="h-5 w-5 text-muted-foreground" />
      <span className="text-[9px] leading-tight text-muted-foreground truncate w-full text-center mt-0.5">
        {t.name || "audio"}
      </span>
    </a>
  );
};

const AttachmentsBlock = ({
  a, onOpenChecklist,
}: { a: Attachments; onOpenChecklist: (id: string) => void }) => {
  const hasSources = a.sources.length > 0;
  const hasCtxLists = a.contextChecklists.length > 0;
  const hasCtxMedia = a.contextMedia.length > 0;
  if (!hasSources && !hasCtxLists && !hasCtxMedia) return null;

  return (
    <div className="mt-2 rounded-lg border border-border/60 bg-muted/30 p-2 space-y-2">
      {hasSources && (
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">Source media</p>
          <div className="flex flex-wrap gap-1.5">
            {a.sources.map((s, i) => (
              <MediaThumb key={`src-${i}-${s.url}`} t={{ url: s.url, type: s.type, label: `Open source ${s.type}` }} />
            ))}
          </div>
        </div>
      )}
      {hasCtxLists && (
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1 inline-flex items-center gap-1">
            <ListChecks className="h-3 w-3" /> Context checklists
          </p>
          <div className="flex flex-wrap gap-1.5">
            {a.contextChecklists.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => onOpenChecklist(c.id)}
                aria-label={`Open checklist ${c.title}`}
                className="inline-flex items-center rounded-full border border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/80 px-2.5 py-0.5 text-xs font-medium max-w-[14rem] truncate"
                title={c.title}
              >
                {c.title}
              </button>
            ))}
          </div>
        </div>
      )}
      {hasCtxMedia && (
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">Context media</p>
          <div className="flex flex-wrap gap-1.5">
            {a.contextMedia.map((m, i) => (
              <MediaThumb
                key={`ctx-${i}-${m.url}`}
                t={{ url: m.url, type: m.type, name: m.name, label: `Open attached ${m.type}${m.name ? `: ${m.name}` : ""}` }}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

// Renders a list of jobs with sequence children visually grouped under their parent.
// `jobs` are the rows visible in the current tab; `allJobs` is the full job list
// so we can find children of a parent that lives in this tab even if the children
// happen to belong to another status (e.g. a still-running parent with completed children).
const GroupedJobList = ({
  jobs, allJobs, renderRow,
}: {
  jobs: Job[];
  allJobs: Job[];
  renderRow: (j: Job) => React.ReactNode;
}) => {
  const visibleIds = new Set(jobs.map((j) => j.id));
  // Hide child jobs whose parent is also visible in this tab — they'll render under the parent.
  const topLevel = jobs.filter((j) => !(j.parent_job_id && visibleIds.has(j.parent_job_id)));

  return (
    <ul className="flex flex-col gap-2 mt-3">
      {topLevel.map((j) => {
        const children = j.action_type === "action-sequence"
          ? allJobs
              .filter((c) => c.parent_job_id === j.id)
              .sort((a, b) => (a.sequence_step ?? 0) - (b.sequence_step ?? 0) || a.created_at.localeCompare(b.created_at))
          : [];
        return (
          <li key={j.id} className="flex flex-col gap-2">
            {renderRow(j)}
            {children.length > 0 && (
              <ul className="flex flex-col gap-2 ml-4 pl-3 border-l-2 border-blue-500/30">
                {children.map((c) => (
                  <div key={c.id} className="relative">
                    <span className="absolute -left-3 top-3 text-[10px] font-semibold text-blue-500/70">
                      {typeof c.sequence_step === "number" ? `#${c.sequence_step + 1}` : ""}
                    </span>
                    {renderRow(c)}
                  </div>
                ))}
              </ul>
            )}
          </li>
        );
      })}
    </ul>
  );
};

const ActionQueue = () => {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [editDialog, setEditDialog] = useState<
    | { mode: EditPromptMode; job: Job; initialPrompt: string; actionLabel: string }
    | null
  >(null);
  const mountedRef = useRef(true);

  useEffect(() => { stopSpeech(); }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // Reliable list fetch — explicit user filter (defense in depth) and surfaces errors.
  const fetchJobs = useCallback(async (uid: string) => {
    setFetchError(null);
    const { data, error } = await supabase
      .from("action_jobs")
      .select(JOB_COLS)
      .eq("user_id", uid)
      .order("created_at", { ascending: false })
      .limit(200);
    if (!mountedRef.current) return;
    if (error) {
      setFetchError(error.message || "Could not load actions.");
      setLoading(false);
      return;
    }
    const mapped: Job[] = (data ?? []).map((r: any) => ({
      id: r.id,
      user_id: r.user_id,
      checklist_id: r.checklist_id,
      source_item_id: r.source_item_id ?? null,
      action_type: r.action_type,
      status: r.status,
      prompt_preview: r.prompt_preview ?? (typeof r.payload?.prompt === "string" ? String(r.payload.prompt).slice(0, 500) : null),
      error_raw: r.error_raw ?? null,
      error_friendly: r.error_friendly ?? null,
      error_fix: r.error_fix ?? null,
      scheduled_for: r.scheduled_for ?? null,
      recurrence: r.recurrence ?? null,
      attempts: r.attempts ?? 0,
      max_attempts: r.max_attempts ?? 3,
      created_at: r.created_at,
      completed_at: r.completed_at ?? null,
      parent_job_id: r.parent_job_id ?? null,
      sequence_step: r.sequence_step ?? null,
      attachments: deriveAttachments(r.action_type, r.payload),
    }));
    setJobs(mapped);
    setLoading(false);
  }, []);

  // Wait for auth to fully resolve before querying. Otherwise RLS silently
  // returns 0 rows and we render an empty dashboard forever.
  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      setJobs([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    fetchJobs(user.id);

    const channel = supabase
      .channel(`action_jobs_dashboard_${user.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "action_jobs", filter: `user_id=eq.${user.id}` },
        (payload) => {
          // Realtime sends the full row (REPLICA IDENTITY FULL) which can include huge payloads.
          // Strip to the lightweight shape so we don't keep megabytes in React state.
          const raw: any = payload.new ?? payload.old;
          if (!raw) return;
          const row: Job = {
            id: raw.id,
            user_id: raw.user_id,
            checklist_id: raw.checklist_id,
            source_item_id: raw.source_item_id ?? null,
            action_type: raw.action_type,
            status: raw.status,
            prompt_preview: raw.prompt_preview ?? (typeof raw.payload?.prompt === "string" ? String(raw.payload.prompt).slice(0, 500) : null),
            error_raw: raw.error_raw ?? null,
            error_friendly: raw.error_friendly ?? null,
            error_fix: raw.error_fix ?? null,
            scheduled_for: raw.scheduled_for ?? null,
            recurrence: raw.recurrence ?? null,
            attempts: raw.attempts ?? 0,
            max_attempts: raw.max_attempts ?? 3,
            created_at: raw.created_at,
            completed_at: raw.completed_at ?? null,
            parent_job_id: raw.parent_job_id ?? null,
            sequence_step: raw.sequence_step ?? null,
            attachments: deriveAttachments(raw.action_type, raw.payload),
          };
          setJobs((prev) => {
            if (payload.eventType === "DELETE") return prev.filter((j) => j.id !== row.id);
            const idx = prev.findIndex((j) => j.id === row.id);
            if (idx === -1) return [row, ...prev];
            const copy = [...prev];
            copy[idx] = row;
            return copy;
          });
        },
      )
      .subscribe((status) => {
        // After a (re)connect, refetch to backfill anything missed mid-flight.
        if (status === "SUBSCRIBED") fetchJobs(user.id);
      });

    // Refetch when the tab becomes visible again — covers laptop sleep / mobile bg.
    const onVis = () => {
      if (document.visibilityState === "visible") fetchJobs(user.id);
    };
    document.addEventListener("visibilitychange", onVis);

    return () => {
      document.removeEventListener("visibilitychange", onVis);
      supabase.removeChannel(channel);
    };
  }, [user, authLoading, fetchJobs]);

  const inQueue = useMemo(() => jobs.filter((j) => ["pending", "scheduled", "running", "paused"].includes(j.status)), [jobs]);
  const completed = useMemo(() => jobs.filter((j) => j.status === "completed"), [jobs]);
  const failed = useMemo(() => jobs.filter((j) => j.status === "failed" || j.status === "cancelled"), [jobs]);

  const update = async (id: string, patch: { status?: Job["status"] }) => {
    const { error } = await supabase.from("action_jobs").update(patch).eq("id", id);
    if (error) toast.error("Could not update job.");
  };

  const remove = async (id: string) => {
    const { error } = await supabase.from("action_jobs").delete().eq("id", id);
    if (error) toast.error("Could not delete job.");
  };

  const openEditDialog = async (j: Job, mode: EditPromptMode) => {
    // Always pull the latest payload so we re-queue with authoritative data.
    const { data: full, error } = await supabase
      .from("action_jobs").select("payload").eq("id", j.id).maybeSingle();
    if (error || !full) { toast.error("Could not load original job."); return; }
    const initialPrompt =
      typeof (full.payload as any)?.prompt === "string"
        ? String((full.payload as any).prompt)
        : (j.prompt_preview ?? "");
    setEditDialog({
      mode, job: j, initialPrompt,
      actionLabel: ACTION_LABELS[j.action_type] ?? j.action_type,
    });
  };

  const submitEdit = async (args: {
    prompt: string;
    recurrence?: "hourly" | "daily" | "weekly" | "monthly" | "yearly";
    scheduled_for?: string;
  }) => {
    if (!editDialog) return;
    const j = editDialog.job;
    // Re-fetch full payload at submit time to avoid stale capture.
    const { data: full, error: fetchErr } = await supabase
      .from("action_jobs").select("payload").eq("id", j.id).maybeSingle();
    if (fetchErr || !full) { toast.error("Could not re-run."); return; }

    // Preserve EVERYTHING from the original payload; only replace `prompt`.
    // This keeps refImageUrls / sourceUrl / imageUrl / context / model params
    // byte-identical to the original run.
    const payload = { ...((full.payload as any) ?? {}), prompt: args.prompt };

    const body: any = {
      action_type: j.action_type,
      checklist_id: j.checklist_id,
      source_item_id: j.source_item_id,
      payload,
    };
    if (editDialog.mode === "recurring") {
      body.scheduled_for = args.scheduled_for;
      body.recurrence = args.recurrence;
    }

    // Route through enqueue-action — same path as the very first run, so the
    // worker is kicked immediately and prompt_preview is recomputed server-side.
    const { error } = await supabase.functions.invoke("enqueue-action", { body });
    if (error) { toast.error("Could not re-queue."); return; }
    toast.success(editDialog.mode === "rerun" ? "Re-queued." : "Recurring schedule saved.");
    setEditDialog(null);
  };

  const JobRow = ({ j }: { j: Job }) => {
    const isFailed = j.status === "failed";
    const canPause = j.status === "pending" || j.status === "scheduled";
    const [copied, setCopied] = useState(false);

    const copyError = async () => {
      const actionLabel = ACTION_LABELS[j.action_type] ?? j.action_type;
      const text =
        `Action: ${actionLabel}\n` +
        `What went wrong: ${j.error_friendly ?? "Something went wrong."}\n` +
        `Fix: ${j.error_fix ?? "(no fix suggested)"}\n` +
        `Raw error:\n${j.error_raw ?? "(no raw error)"}`;
      try {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        toast.success("Error details copied");
        setTimeout(() => setCopied(false), 1500);
      } catch {
        toast.error("Could not copy");
      }
    };

    return (
      <li className={`rounded-xl border p-3 ${isFailed ? "border-destructive/40 bg-destructive/5" : "border-border bg-card"}`}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-medium text-sm">{ACTION_LABELS[j.action_type] ?? j.action_type}</span>
              <StatusBadge s={j.status} />
              {j.recurrence && (
                <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                  <Repeat className="h-3 w-3" />{j.recurrence}
                </span>
              )}
              {j.attempts > 0 && (
                <span className="text-xs text-muted-foreground">attempt {j.attempts}/{j.max_attempts}</span>
              )}
            </div>
            <p className="mt-1 text-sm text-muted-foreground line-clamp-2">
              {j.prompt_preview ?? "(no prompt)"}
            </p>
            <div className="mt-1 text-xs text-muted-foreground">
              {j.scheduled_for ? `Runs ${fmt(j.scheduled_for)}` : `Created ${fmt(j.created_at)}`}
              {j.completed_at && ` · Done ${fmt(j.completed_at)}`}
            </div>

            <AttachmentsBlock a={j.attachments} onOpenChecklist={(id) => navigate(`/?c=${id}`)} />
            {isFailed && (
              <div className="mt-2 rounded-lg bg-destructive/10 p-2 text-sm">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-start gap-2 min-w-0 flex-1">
                    <AlertTriangle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-muted-foreground">
                        {ACTION_LABELS[j.action_type] ?? j.action_type}
                      </p>
                      <p className="font-medium text-destructive mt-0.5">{j.error_friendly ?? "Something went wrong."}</p>
                      {j.error_fix && <p className="text-foreground/80 mt-1"><strong>Fix:</strong> {j.error_fix}</p>}
                      {j.error_raw && (
                        <details className="mt-1">
                          <summary className="text-xs text-muted-foreground cursor-pointer">Raw error</summary>
                          <pre className="text-xs mt-1 whitespace-pre-wrap break-all">{j.error_raw}</pre>
                        </details>
                      )}
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={copyError}
                    className="shrink-0 h-7 px-2"
                    aria-label="Copy error details"
                  >
                    {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                    {copied ? "Copied" : "Copy"}
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="mt-2 flex flex-wrap gap-1.5">
          {canPause && (
            <Button size="sm" variant="outline" onClick={() => update(j.id, { status: "paused" })}>
              <Pause className="h-3.5 w-3.5" />Pause
            </Button>
          )}
          {j.status === "running" && (
            <Button
              size="sm"
              variant="destructive"
              onClick={async () => {
                await update(j.id, { status: "cancelled" });
                toast.message("Stopping… this may take a few seconds.");
              }}
            >
              <Square className="h-3.5 w-3.5" />Stop
            </Button>
          )}
          {j.status === "paused" && (
            <Button size="sm" variant="outline" onClick={() => update(j.id, { status: "pending" })}>
              <Play className="h-3.5 w-3.5" />Resume
            </Button>
          )}
          {(j.status === "completed" || j.status === "failed" || j.status === "cancelled") && (
            <Button size="sm" variant="outline" onClick={() => openEditDialog(j, "rerun")}>
              <RotateCw className="h-3.5 w-3.5" />Re-run
            </Button>
          )}
          {j.status === "completed" && !j.recurrence && (
            <Button size="sm" variant="outline" onClick={() => openEditDialog(j, "recurring")}>
              <Repeat className="h-3.5 w-3.5" />Make recurring
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={() => navigate(`/?c=${j.checklist_id}`)}>
            <ExternalLink className="h-3.5 w-3.5" />Open checklist
          </Button>
          <Button size="sm" variant="ghost" onClick={() => remove(j.id)} className="text-destructive">
            <Trash2 className="h-3.5 w-3.5" />Delete
          </Button>
        </div>
      </li>
    );
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-10 border-b border-border bg-background/80 backdrop-blur px-4 py-3 flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate("/")}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <h1 className="text-lg font-semibold flex-1">Action Queue Dashboard</h1>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => { if (user) { setLoading(true); fetchJobs(user.id); } }}
          disabled={!user || loading}
          aria-label="Refresh"
        >
          <RefreshCw className={`h-5 w-5 ${loading ? "animate-spin" : ""}`} />
        </Button>
      </header>

      {fetchError && (
        <div className="max-w-2xl mx-auto px-4 pt-3">
          <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="font-medium text-destructive">Could not load actions.</p>
              <p className="text-xs text-muted-foreground mt-0.5 break-words">{fetchError}</p>
            </div>
            <Button size="sm" variant="outline" onClick={() => { if (user) { setLoading(true); fetchJobs(user.id); } }}>
              Retry
            </Button>
          </div>
        </div>
      )}

      <main className="max-w-2xl mx-auto p-4 pb-20">
        <Tabs defaultValue="queue" className="w-full">
          <TabsList className="grid grid-cols-3 w-full">
            <TabsTrigger value="queue">In queue <Badge variant="secondary" className="ml-2">{inQueue.length}</Badge></TabsTrigger>
            <TabsTrigger value="completed">Completed <Badge variant="secondary" className="ml-2">{completed.length}</Badge></TabsTrigger>
            <TabsTrigger value="failed">Failed / Stopped <Badge variant="secondary" className="ml-2">{failed.length}</Badge></TabsTrigger>
          </TabsList>

          <TabsContent value="queue">
            {loading ? <p className="text-muted-foreground text-sm py-6 text-center">Loading…</p>
              : inQueue.length === 0 ? <p className="text-muted-foreground text-sm py-6 text-center">No queued actions.</p>
              : <GroupedJobList jobs={inQueue} allJobs={jobs} renderRow={(j) => <JobRow key={j.id} j={j} />} />}
          </TabsContent>
          <TabsContent value="completed">
            {completed.length === 0 ? <p className="text-muted-foreground text-sm py-6 text-center">No completed actions yet.</p>
              : <GroupedJobList jobs={completed} allJobs={jobs} renderRow={(j) => <JobRow key={j.id} j={j} />} />}
          </TabsContent>
          <TabsContent value="failed">
            {failed.length === 0 ? <p className="text-muted-foreground text-sm py-6 text-center">No failed or stopped actions.</p>
              : <GroupedJobList jobs={failed} allJobs={jobs} renderRow={(j) => <JobRow key={j.id} j={j} />} />}
          </TabsContent>
        </Tabs>
      </main>

      {editDialog && (
        <EditPromptRunDialog
          open
          mode={editDialog.mode}
          actionLabel={editDialog.actionLabel}
          initialPrompt={editDialog.initialPrompt}
          onCancel={() => setEditDialog(null)}
          onConfirm={submitEdit}
        />
      )}
    </div>
  );
};

export default ActionQueue;
