import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { FileText } from "lucide-react";
import { toast } from "sonner";

export default function AcceptInvite() {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  // Start as true — we'll set to false only if no valid invite session is found
  const [sessionReady, setSessionReady] = useState(false);
  const [checking, setChecking] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    // Sign out any existing session so the invite token can be properly exchanged
    supabase.auth.signOut().then(() => {
      // After signing out, listen for the SIGNED_IN event from the invite token in the URL
      const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
        if (event === "SIGNED_IN" && session) {
          // User was signed in via invite link — show password form
          setSessionReady(true);
          setChecking(false);
        } else if (event === "SIGNED_OUT" && !session) {
          // Still waiting for token exchange, give it a moment
          setTimeout(() => setChecking(false), 3000);
        }
      });

      // Also check if there's already a session (token was already exchanged)
      supabase.auth.getSession().then(({ data: { session } }) => {
        if (session) {
          setSessionReady(true);
          setChecking(false);
        }
      });

      return () => subscription.unsubscribe();
    });
  }, []);

  // Timeout fallback — if nothing happens after 5s, show invalid link
  useEffect(() => {
    const timer = setTimeout(() => {
      setChecking(false);
    }, 5000);
    return () => clearTimeout(timer);
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirmPassword) {
      toast.error("Passwords do not match");
      return;
    }
    if (password.length < 8) {
      toast.error("Password must be at least 8 characters");
      return;
    }

    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password });
    if (error) {
      toast.error(error.message);
    } else {
      toast.success("Account created! Welcome aboard.");
      navigate("/");
    }
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

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center">
          <div className="inline-flex h-12 w-12 items-center justify-center rounded-xl bg-primary mb-4">
            <FileText className="h-6 w-6 text-primary-foreground" />
          </div>
          <h1 className="text-2xl font-bold text-foreground">Create Your Password</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Set a password to complete your account setup.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="vault-card p-6 space-y-4">
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">New Password</label>
            <input
              type="password"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              placeholder="••••••••"
            />
          </div>
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
            {loading ? "Setting up account..." : "Create Account"}
          </Button>
        </form>
      </div>
    </div>
  );
}
