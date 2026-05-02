import { supabase } from "@/integrations/supabase/client";

export type ContextGroup = {
  id: string;
  title: string;
  checklist_count: number;
};

export type ContextGroupChecklist = { id: string; title: string };

export const listGroups = async (): Promise<ContextGroup[]> => {
  const { data: groups, error } = await supabase
    .from("context_groups")
    .select("id,title")
    .order("title", { ascending: true });
  if (error) throw error;
  if (!groups || groups.length === 0) return [];

  const { data: members } = await supabase
    .from("context_group_checklists")
    .select("group_id");
  const counts = new Map<string, number>();
  (members ?? []).forEach((m: { group_id: string }) => {
    counts.set(m.group_id, (counts.get(m.group_id) ?? 0) + 1);
  });
  return groups.map((g) => ({ id: g.id, title: g.title, checklist_count: counts.get(g.id) ?? 0 }));
};

export const getGroupChecklists = async (groupId: string): Promise<ContextGroupChecklist[]> => {
  const { data: links, error } = await supabase
    .from("context_group_checklists")
    .select("checklist_id, position")
    .eq("group_id", groupId)
    .order("position", { ascending: true });
  if (error) throw error;
  const ids = (links ?? []).map((l) => l.checklist_id);
  if (ids.length === 0) return [];
  const { data: checklists } = await supabase
    .from("checklists")
    .select("id,title")
    .in("id", ids);
  const byId = new Map((checklists ?? []).map((c) => [c.id, c.title] as const));
  // Preserve link order, drop missing checklists.
  return ids
    .filter((id) => byId.has(id))
    .map((id) => ({ id, title: byId.get(id)! }));
};

export const createGroup = async (
  userId: string,
  title: string,
  checklistIds: string[],
): Promise<string> => {
  const { data, error } = await supabase
    .from("context_groups")
    .insert({ user_id: userId, title: title.trim() || "Untitled group" })
    .select("id")
    .single();
  if (error) throw error;
  const groupId = data.id as string;
  if (checklistIds.length > 0) {
    const rows = checklistIds.map((cid, idx) => ({
      user_id: userId,
      group_id: groupId,
      checklist_id: cid,
      position: idx,
    }));
    const { error: linkErr } = await supabase.from("context_group_checklists").insert(rows);
    if (linkErr) throw linkErr;
  }
  return groupId;
};

export const updateGroup = async (
  userId: string,
  groupId: string,
  title: string,
  checklistIds: string[],
): Promise<void> => {
  const { error: titleErr } = await supabase
    .from("context_groups")
    .update({ title: title.trim() || "Untitled group" })
    .eq("id", groupId);
  if (titleErr) throw titleErr;

  // Replace memberships.
  const { error: delErr } = await supabase
    .from("context_group_checklists")
    .delete()
    .eq("group_id", groupId);
  if (delErr) throw delErr;
  if (checklistIds.length > 0) {
    const rows = checklistIds.map((cid, idx) => ({
      user_id: userId,
      group_id: groupId,
      checklist_id: cid,
      position: idx,
    }));
    const { error: insErr } = await supabase.from("context_group_checklists").insert(rows);
    if (insErr) throw insErr;
  }
};

export const deleteGroup = async (groupId: string): Promise<void> => {
  const { error } = await supabase.from("context_groups").delete().eq("id", groupId);
  if (error) throw error;
};
