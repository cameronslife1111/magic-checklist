import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, Pencil, Trash2, Layers } from "lucide-react";
import { toast } from "sonner";
import {
  listGroups,
  getGroupChecklists,
  createGroup,
  updateGroup,
  deleteGroup,
  type ContextGroup,
} from "@/lib/contextGroups";
import { ChecklistMultiPicker } from "@/components/ContextAttacher";

type Props = {
  open: boolean;
  userId: string;
  onOpenChange: (o: boolean) => void;
};

type EditorState =
  | { mode: "list" }
  | { mode: "edit"; id: string | null; title: string; checklists: { id: string; title: string }[] };

export const ContextGroupsManager = ({ open, userId, onOpenChange }: Props) => {
  const [groups, setGroups] = useState<ContextGroup[]>([]);
  const [loading, setLoading] = useState(false);
  const [editor, setEditor] = useState<EditorState>({ mode: "list" });
  const [pickerOpen, setPickerOpen] = useState(false);

  const refresh = async () => {
    setLoading(true);
    try { setGroups(await listGroups()); }
    catch { toast.error("Could not load context groups."); }
    finally { setLoading(false); }
  };

  useEffect(() => {
    if (open) {
      setEditor({ mode: "list" });
      refresh();
    }
  }, [open]);

  const startNew = () => setEditor({ mode: "edit", id: null, title: "", checklists: [] });

  const startEdit = async (g: ContextGroup) => {
    try {
      const checklists = await getGroupChecklists(g.id);
      setEditor({ mode: "edit", id: g.id, title: g.title, checklists });
    } catch { toast.error("Could not load group."); }
  };

  const remove = async (g: ContextGroup) => {
    if (!confirm(`Delete context group "${g.title}"?`)) return;
    try {
      await deleteGroup(g.id);
      toast.success("Group deleted.");
      refresh();
    } catch { toast.error("Could not delete group."); }
  };

  const save = async () => {
    if (editor.mode !== "edit") return;
    const title = editor.title.trim();
    if (!title) { toast.error("Please enter a title."); return; }
    try {
      if (editor.id) {
        await updateGroup(userId, editor.id, title, editor.checklists.map((c) => c.id));
        toast.success("Group updated.");
      } else {
        await createGroup(userId, title, editor.checklists.map((c) => c.id));
        toast.success("Group created.");
      }
      setEditor({ mode: "list" });
      refresh();
    } catch { toast.error("Could not save group."); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Layers className="h-4 w-4" />
            {editor.mode === "list" ? "Context Groups" : editor.id ? "Edit group" : "New group"}
          </DialogTitle>
        </DialogHeader>

        {editor.mode === "list" ? (
          <div className="space-y-3">
            <Button onClick={startNew} className="w-full justify-start" variant="outline">
              <Plus className="h-4 w-4" /> New group
            </Button>
            {loading ? (
              <p className="text-sm text-muted-foreground py-4 text-center">Loading…</p>
            ) : groups.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">
                No context groups yet. Create one to bundle checklists for quick reuse.
              </p>
            ) : (
              <ul className="divide-y divide-border max-h-72 overflow-y-auto -mx-2">
                {groups.map((g) => (
                  <li key={g.id} className="flex items-center gap-2 px-2 py-2">
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate">{g.title}</div>
                      <div className="text-xs text-muted-foreground">
                        {g.checklist_count} checklist{g.checklist_count === 1 ? "" : "s"}
                      </div>
                    </div>
                    <Button size="icon" variant="ghost" onClick={() => startEdit(g)} aria-label="Edit">
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button size="icon" variant="ghost" onClick={() => remove(g)} aria-label="Delete" className="text-red-500 hover:text-red-500">
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Title</label>
              <Input
                value={editor.title}
                onChange={(e) => setEditor({ ...editor, title: e.target.value })}
                placeholder="e.g. Morning routine"
                autoFocus
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">
                Checklists ({editor.checklists.length})
              </label>
              <Button variant="outline" className="w-full justify-start" onClick={() => setPickerOpen(true)}>
                <Plus className="h-4 w-4" /> Select checklists
              </Button>
              {editor.checklists.length > 0 && (
                <div className="flex flex-wrap gap-1.5 pt-1 max-h-40 overflow-y-auto">
                  {editor.checklists.map((c) => (
                    <span key={c.id} className="inline-flex items-center gap-1 text-xs bg-background border rounded-full px-2 py-0.5 max-w-[200px]">
                      <span className="truncate">{c.title}</span>
                    </span>
                  ))}
                </div>
              )}
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="ghost" onClick={() => setEditor({ mode: "list" })}>Cancel</Button>
              <Button onClick={save}>Save</Button>
            </div>

            <ChecklistMultiPicker
              open={pickerOpen}
              selected={editor.checklists}
              onClose={() => setPickerOpen(false)}
              onConfirm={(picks) => {
                setEditor({ ...editor, checklists: picks });
                setPickerOpen(false);
              }}
            />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};
