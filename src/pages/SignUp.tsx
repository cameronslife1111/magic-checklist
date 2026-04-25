import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { z } from "zod";

const schema = z.object({
  email: z.string().email("Enter a valid email."),
  password: z.string().min(1, "Password cannot be empty."),
  confirm: z.string(),
}).refine((d) => d.password === d.confirm, { message: "Passwords do not match.", path: ["confirm"] });

const SignUp = () => {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const parsed = schema.safeParse({ email, password, confirm });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Invalid input.");
      return;
    }
    setLoading(true);
    const { data, error } = await supabase.auth.signUp({
      email, password,
      options: { emailRedirectTo: `${window.location.origin}/` },
    });
    if (error) {
      setLoading(false);
      setError("Could not create account. Try again.");
      return;
    }
    // Auto-confirm is on, so a session should exist. If not, sign in.
    if (!data.session) {
      const { error: e2 } = await supabase.auth.signInWithPassword({ email, password });
      if (e2) {
        setLoading(false);
        setError("Account created. Please log in.");
        navigate("/login");
        return;
      }
    }
    // Create starter checklist
    const userId = (await supabase.auth.getUser()).data.user?.id;
    if (userId) {
      const { data: cl } = await supabase
        .from("checklists")
        .insert({ user_id: userId, title: "My first checklist" })
        .select().single();
      if (cl) {
        await supabase.from("checklist_items").insert([
          { checklist_id: cl.id, user_id: userId, text: "Welcome to Magic Checklist.", position: 1 },
          { checklist_id: cl.id, user_id: userId, text: "Tap a checkbox to check it off.", position: 2 },
          { checklist_id: cl.id, user_id: userId, text: "Use the Actions button to do more.", position: 3 },
        ]);
      }
    }
    setLoading(false);
    navigate("/", { replace: true });
  };

  return (
    <main className="min-h-screen flex items-center justify-center px-6 bg-background">
      <div className="w-full max-w-sm">
        <h1 className="text-2xl font-semibold mb-1">Create account</h1>
        <p className="text-sm text-muted-foreground mb-8">Start your first checklist.</p>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="confirm">Confirm password</Label>
            <Input id="confirm" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="submit" className="w-full h-12 text-base" disabled={loading || !email || !password || !confirm}>
            {loading ? "Creating…" : "Create account"}
          </Button>
          <Link to="/login" className="block text-center text-sm text-primary underline-offset-4 hover:underline pt-2">
            Back to log in
          </Link>
        </form>
      </div>
    </main>
  );
};

export default SignUp;
