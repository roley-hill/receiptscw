import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { FileText, CheckCircle } from "lucide-react";
import { toast } from "sonner";

export default function AcceptInvite() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [sessionReady, setSessionReady] = useState(false);
  const [checking, setChecking] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    let resolved = false;

    const resolve = (ready: boolean, userEmail?: string) => {
      if (!resolved) {
        resolved = true;
        if (userEmail) setEmail(userEmail);
        setSessionReady(ready);
        setChecking(false);
      }
    };

    // Handle newer Supabase PKCE flow — token_hash in URL query params
    const urlParams = new URLSearchParams(window.location.search);
    const tokenHash = urlParams.get("token_hash");
    const type = urlParams.get("type");

    if (tokenHash && type === "invite") {
      supabase.auth.verifyOtp({ token_hash: tokenHash, type: "invite" }).then(({ data, error }) => {
        if (error) {
          console.error("[AcceptInvite] verifyOtp error:", error.message);
          resolve(false);
        } else if (data.session) {
          resolve(true, data.session.user.email ?? "");
        }
      });
      return;
    }

    // Handle older hash fragment flow (#access_token=...&type=invite)
    const hash = window.location.hash;
    const hashParams = new URLSearchParams(hash.replace("#", ""));
    const hashType = hashParams.get("type");

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (session?.user) {
        const isInvite = hashType === "invite" || !session.user.email_confirmed_at;
        resolve(isInvite, session.user.email ?? "");
      }
    });

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) {
        const isInvite = hashType === "invite" || !session.user.email_confirmed_at;
        resolve(isInvite, session.user.email ?? "");
      }
    });

    const timer = setTimeout(() => resolve(false), 10000);

    return () => {
      subscription.unsubscribe();
      clearTimeout(timer);
    };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!name.trim()) {
      toast.error("Please enter your name");
      return;
    }
    if (password !== confirmPassword) {
      toast.error("Passwords do not match");
      return;
    }
    if (password.length < 8) {
      toast.error("Password must be at least 8 characters");
      return;
    }

    setLoading(true);
    const { error } = await supabase.auth.updateUser({
      password,
      data: { display_name: name.trim() },
    });

    if (error) {
      toast.error(error.message);
      setLoading(false);
      return;
    }

    // Also update the profiles table with the display name
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      await supabase
        .from("profiles")
        .update({ display_name: name.trim() })
        .eq("user_id", user.id);
    }

    // Sign out and show success — they'll log in with their new credentials
    await supabase.auth.signOut();
    setDone(true);
    setLoading(false);
  };

  if (checking) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="text-center">
          <div className="h-8 w-8 border-2 border-accent border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">Verifying your invite link...</p>
        </div>
      </div>
    );
  }

  if (!sessionReady) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="w-full max-w-sm space-y-6 text-center">
          <div className="inline-flex h-12 w-12 items-center justify-center rounded-xl bg-primary mb-4">
            <FileText className="h-6 w-6 text-primary-foreground" />
          </div>
          <h1 className="text-2xl font-bold text-foreground">Invalid Invite Link</h1>
          <p className="text-sm text-muted-foreground">
            This invite link is invalid or has expired. Please ask your admin to resend the invite.
          </p>
          <Button onClick={() => navigate("/auth")} className="w-full">
            Back to Sign In
          </Button>
        </div>
      </div>
    );
  }

  if (done) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="w-full max-w-sm space-y-6 text-center">
          <div className="inline-flex h-12 w-12 items-center justify-center rounded-xl bg-primary mb-4">
            <CheckCircle className="h-6 w-6 text-primary-foreground" />
          </div>
          <h1 className="text-2xl font-bold text-foreground">Account Created!</h1>
          <p className="text-sm text-muted-foreground">
            Your account has been set up successfully. You can now sign in with your email and password.
          </p>
          <Button onClick={() => navigate("/auth")} className="w-full">
            Sign In
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center">
          <div className="inline-flex h-12 w-12 items-center justify-center rounded-xl bg-primary mb-4">
            <FileText className="h-6 w-6 text-primary-foreground" />
          </div>
          <h1 className="text-2xl font-bold text-foreground">Create Your Account</h1>
          <p className="text-sm text-muted-foreground mt-1">
            You've been invited. Fill in your details to get started.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="vault-card p-6 space-y-4">
          {/* Email — pre-filled and read-only */}
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Email</label>
            <input
              type="email"
              readOnly
              value={email}
              className="w-full h-10 rounded-md border border-input bg-muted px-3 text-sm text-muted-foreground cursor-not-allowed"
            />
          </div>

          {/* Display name */}
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Your Name</label>
            <input
              type="text"
              required
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              placeholder="Jane Smith"
            />
          </div>

          {/* Password */}
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Password</label>
            <input
              type="password"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              placeholder="Min. 8 characters"
            />
          </div>

          {/* Confirm Password */}
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Confirm Password</label>
            <input
              type="password"
              required
              minLength={8}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              placeholder="••••••••"
            />
          </div>

          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? "Creating account..." : "Create Account"}
          </Button>
        </form>
      </div>
    </div>
  );
}
