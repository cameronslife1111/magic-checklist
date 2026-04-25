export type Checklist = {
  id: string;
  user_id: string;
  title: string;
  background_color: string;
  created_at: string;
  updated_at: string;
};

export type ChecklistItem = {
  id: string;
  checklist_id: string;
  user_id: string;
  text: string;
  checked: boolean;
  position: number;
  external_link: string | null;
  linked_checklist_id: string | null;
  media_url: string | null;
  media_type: string | null;
  created_at: string;
  updated_at: string;
};
