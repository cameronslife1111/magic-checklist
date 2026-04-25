import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ArrowLeft, Pause, Play, Trash2, RotateCw, Repeat, AlertTriangle, ExternalLink, Copy, Check, Square, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { stopSpeech } from "@/lib/speech";

type Job = {
  id: string;
  user_id: string;
  checklist_id: string;
  source_item_id: string | null;
  action_type: string;
  status: "pending" | "scheduled" | "running" | "completed" | "failed" | "paused" | "cancelled";
  payload: any;
  result: any;
  error_raw: string | null;
  error_friendly: string | null;
  error_fix: string | null;
  scheduled_for: string | null;
  recurrence: string | null;
  attempts: number;
  max_attempts: number;
  created_at: string;
  completed_at: string | null;
};

const ACTION_LABELS: Record<string, string> = {
  "text-text": "Text to text",
  "text-image": "Text to image",
  "image-image": "Image to image",
  "remix": "Remix images",
  "image-video": "Image to video",
  "video-video": "Video to video",
  "analyze-image": "Analyze image",
  "web-search": "Web search",
};

const fmt = (iso: string | null) => {
  if (!iso) return "";
  try { return new Date(iso).toLocaleString(); } catch { return iso; }
};

const StatusBadge = ({ s }: { s: Job["status"] }) => {
  const map: Record<Job["status"], string> = {
    pending: "bg-muted text-foreground",
    scheduled: "bg-blue-500/15 text-blue-700 dark:text-blue-300",
    running: "bg-amber-500/15 text-amber-700 dark:text-amber-300 animate-pulse",
    completed: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
    failed: "bg-destructive/15 text-destructive",
    paused: "bg-muted text-muted-foreground",
    cancelled: "bg-muted text-muted-foreground line-through",
  };
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${map[s]}`}>{s}</span>;
};

const ActionQueue = () => {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
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
      .select("*")
      .eq("user_id", uid)
      .order("created_at", { ascending: false })
      .limit(200);
    if (!mountedRef.current) return;
    if (error) {
      setFetchError(error.message || "Could not load actions.");
      setLoading(false);
      return;
    }
    setJobs((data ?? []) as Job[]);
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
          setJobs((prev) => {
            const row = (payload.new ?? payload.old) as Job;
            if (!row) return prev;
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

  const update = async (id: string, patch: Partial<Job>) => {
    const { error } = await supabase.from("action_jobs").update(patch).eq("id", id);
    if (error) toast.error("Could not update job.");
  };

  const remove = async (id: string) => {
    const { error } = await supabase.from("action_jobs").delete().eq("id", id);
    if (error) toast.error("Could not delete job.");
  };

  const rerun = async (j: Job) => {
    const { error } = await supabase.from("action_jobs").insert({
      user_id: j.user_id,
      checklist_id: j.checklist_id,
      source_item_id: j.source_item_id,
      action_type: j.action_type,
      status: "pending",
      payload: j.payload,
    });
    if (error) toast.error("Could not re-run.");
    else toast.success("Re-queued.");
  };

  const saveRecurring = async (j: Job) => {
    const next = prompt("Repeat every (hourly, daily, weekly, monthly, yearly):", j.recurrence ?? "daily");
    if (!next) return;
    const valid = ["hourly", "daily", "weekly", "monthly", "yearly"];
    if (!valid.includes(next)) { toast.error("Invalid interval."); return; }
    const { error } = await supabase.from("action_jobs").insert({
      user_id: j.user_id,
      checklist_id: j.checklist_id,
      source_item_id: j.source_item_id,
      action_type: j.action_type,
      status: "scheduled",
      payload: j.payload,
      scheduled_for: new Date(Date.now() + 60_000).toISOString(),
      recurrence: next,
    });
    if (error) toast.error("Could not save recurring.");
    else toast.success("Recurring schedule saved.");
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
              {j.payload?.prompt ?? "(no prompt)"}
            </p>
            <div className="mt-1 text-xs text-muted-foreground">
              {j.scheduled_for ? `Runs ${fmt(j.scheduled_for)}` : `Created ${fmt(j.created_at)}`}
              {j.completed_at && ` · Done ${fmt(j.completed_at)}`}
            </div>

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
            <Button size="sm" variant="outline" onClick={() => rerun(j)}>
              <RotateCw className="h-3.5 w-3.5" />Re-run
            </Button>
          )}
          {j.status === "completed" && !j.recurrence && (
            <Button size="sm" variant="outline" onClick={() => saveRecurring(j)}>
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
        <h1 className="text-lg font-semibold">Action Queue Dashboard</h1>
      </header>

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
              : <ul className="flex flex-col gap-2 mt-3">{inQueue.map((j) => <JobRow key={j.id} j={j} />)}</ul>}
          </TabsContent>
          <TabsContent value="completed">
            {completed.length === 0 ? <p className="text-muted-foreground text-sm py-6 text-center">No completed actions yet.</p>
              : <ul className="flex flex-col gap-2 mt-3">{completed.map((j) => <JobRow key={j.id} j={j} />)}</ul>}
          </TabsContent>
          <TabsContent value="failed">
            {failed.length === 0 ? <p className="text-muted-foreground text-sm py-6 text-center">No failed or stopped actions.</p>
              : <ul className="flex flex-col gap-2 mt-3">{failed.map((j) => <JobRow key={j.id} j={j} />)}</ul>}
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
};

export default ActionQueue;
