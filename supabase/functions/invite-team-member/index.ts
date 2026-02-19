import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Missing auth");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Verify caller is authenticated
    const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) throw new Error("Not authenticated");

    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    // Check caller is admin
    const { data: callerRole } = await adminClient
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .single();
    if (callerRole?.role !== "admin") throw new Error("Admin access required");

    if (req.method === "DELETE") {
      const { user_id } = await req.json();
      if (!user_id) throw new Error("user_id required");
      if (user_id === user.id) throw new Error("Cannot remove yourself");

      const { error } = await adminClient.auth.admin.deleteUser(user_id);
      if (error) throw error;

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // POST - invite user via email
    const { email, role } = await req.json();
    if (!email) throw new Error("Email required");
    const validRoles = ["admin", "processor", "viewer"];
    if (role && !validRoles.includes(role)) throw new Error("Invalid role");

    // Use inviteUserByEmail — sends a secure email with a sign-up link
    const { data: inviteData, error: inviteErr } = await adminClient.auth.admin.inviteUserByEmail(email, {
      redirectTo: `${Deno.env.get("SUPABASE_URL")?.replace(".supabase.co", "") || ""}/`,
    });
    if (inviteErr) throw inviteErr;

    const newUserId = inviteData.user.id;

    // The handle_new_user trigger creates profile + default 'processor' role.
    // Update role if different from default.
    if (role && role !== "processor") {
      await adminClient
        .from("user_roles")
        .update({ role })
        .eq("user_id", newUserId);
    }

    return new Response(JSON.stringify({ success: true, user_id: newUserId }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
