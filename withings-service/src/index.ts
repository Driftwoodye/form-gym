export interface Env {
  DB: D1Database;
  WITHINGS_CLIENT_ID: string;
  WITHINGS_CLIENT_SECRET: string;
  WITHINGS_REDIRECT_URI: string;
  FORM_ACCESS_PIN: string;
  APP_ORIGIN: string;
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
});
const html = (body: string, status = 200) => new Response(body, {
  status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" }
});
const randomState = () => {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
};
const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c]!));

async function withingsToken(env: Env, row: any) {
  if (row.expires_at > Math.floor(Date.now() / 1000) + 60) return row.access_token;
  const body = new URLSearchParams({
    action: "requesttoken", grant_type: "refresh_token",
    client_id: env.WITHINGS_CLIENT_ID, client_secret: env.WITHINGS_CLIENT_SECRET,
    refresh_token: row.refresh_token
  });
  const response = await fetch("https://wbsapi.withings.net/v2/oauth2", {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body
  });
  const payload: any = await response.json();
  if (!response.ok || payload.status !== 0 || !payload.body?.access_token) {
    throw new Error("Withings token refresh failed. Reconnect Withings from FORM.");
  }
  const t = payload.body;
  await env.DB.prepare("UPDATE withings_tokens SET access_token=?, refresh_token=?, expires_at=?, updated_at=? WHERE id=1")
    .bind(t.access_token, t.refresh_token || row.refresh_token, Math.floor(Date.now()/1000) + Number(t.expires_in || 10800), new Date().toISOString()).run();
  return t.access_token as string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: {
      "access-control-allow-origin": env.APP_ORIGIN, "access-control-allow-methods": "GET,POST,OPTIONS",
      "access-control-allow-headers": "content-type,authorization", "vary": "Origin"
    }});
    const cors = { "access-control-allow-origin": env.APP_ORIGIN, "vary": "Origin" };
    if (url.pathname === "/health") return json({ ok: true }, 200);
    if (url.origin !== new URL(env.APP_ORIGIN).origin) {
      // API responses are only intended for the configured FORM origin.
    }
    if (url.pathname.startsWith("/api/") || url.pathname === "/connect") {
      const auth = request.headers.get("authorization") || "";
      if (auth !== `Bearer ${env.FORM_ACCESS_PIN}`) return json({ error: "Unauthorised" }, 401);
    }

    if (url.pathname === "/connect" && request.method === "GET") {
      const state = randomState();
      await env.DB.prepare("INSERT OR REPLACE INTO oauth_state (id, created_at) VALUES (1, ?)")
        .bind(Math.floor(Date.now()/1000)).run();
      await env.DB.prepare("CREATE TABLE IF NOT EXISTS oauth_state (id INTEGER PRIMARY KEY, state TEXT, created_at INTEGER)").run();
      await env.DB.prepare("UPDATE oauth_state SET state=?, created_at=? WHERE id=1")
        .bind(state, Math.floor(Date.now()/1000)).run();
      const target = new URL("https://account.withings.com/oauth2_user/authorize2");
      target.search = new URLSearchParams({
        response_type: "code", client_id: env.WITHINGS_CLIENT_ID,
        scope: "user.metrics", redirect_uri: env.WITHINGS_REDIRECT_URI, state
      }).toString();
      return Response.redirect(target.toString(), 302);
    }

    if (url.pathname === "/callback" && request.method === "GET") {
      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");
      const saved: any = await env.DB.prepare("SELECT state, created_at FROM oauth_state WHERE id=1").first();
      if (!code || !state || !saved || state !== saved.state || Math.floor(Date.now()/1000) - saved.created_at > 600) {
        return html("<h1>Connection could not be verified</h1><p>Return to FORM and try connecting again.</p>", 400);
      }
      const body = new URLSearchParams({
        action: "requesttoken", grant_type: "authorization_code", client_id: env.WITHINGS_CLIENT_ID,
        client_secret: env.WITHINGS_CLIENT_SECRET, code, redirect_uri: env.WITHINGS_REDIRECT_URI
      });
      const response = await fetch("https://wbsapi.withings.net/v2/oauth2", {
        method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body
      });
      const payload: any = await response.json();
      if (!response.ok || payload.status !== 0 || !payload.body?.access_token) {
        return html("<h1>Withings connection failed</h1><p>Return to FORM and check the Withings app settings.</p>", 502);
      }
      const t = payload.body;
      await env.DB.prepare(`INSERT OR REPLACE INTO withings_tokens (id, userid, access_token, refresh_token, expires_at, updated_at)
        VALUES (1, ?, ?, ?, ?, ?)`).bind(String(t.userid), t.access_token, t.refresh_token,
          Math.floor(Date.now()/1000) + Number(t.expires_in || 10800), new Date().toISOString()).run();
      await env.DB.prepare("DELETE FROM oauth_state WHERE id=1").run();
      return html(`<!doctype html><meta name="viewport" content="width=device-width"><title>FORM connected</title>
        <main style="font:16px system-ui;max-width:36rem;margin:12vh auto;padding:24px">
        <h1>Withings connected</h1><p>FORM can now retrieve your measurements. Return to the FORM app and use Sync Withings.</p>
        <p><a href="${esc(env.APP_ORIGIN)}">Open FORM</a></p></main>`);
    }

    if (url.pathname === "/api/status" && request.method === "GET") {
      const row: any = await env.DB.prepare("SELECT userid, updated_at FROM withings_tokens WHERE id=1").first();
      return new Response(JSON.stringify({ connected: !!row, updatedAt: row?.updated_at || null }), {
        headers: { ...cors, "content-type": "application/json", "cache-control": "no-store" }
      });
    }

    if (url.pathname === "/api/measures" && request.method === "GET") {
      const row: any = await env.DB.prepare("SELECT * FROM withings_tokens WHERE id=1").first();
      if (!row) return json({ error: "Connect Withings first." }, 409);
      try {
        const accessToken = await withingsToken(env, row);
        const params = new URLSearchParams({
          action: "getmeas", meastypes: "1,5,6,8,76,77,88",
          category: "1", startdate: String(Math.floor(Date.now()/1000) - 366*86400),
          enddate: String(Math.floor(Date.now()/1000))
        });
        const response = await fetch("https://wbsapi.withings.net/measure", {
          method: "POST", headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/x-www-form-urlencoded" }, body: params
        });
        const payload: any = await response.json();
        if (!response.ok || payload.status !== 0) return json({ error: "Withings could not return measurements." }, 502);
        const measures = (payload.body?.measuregrps || []).map((g: any) => {
          const values: Record<string, number> = {};
          for (const m of g.measures || []) {
            const factor = Math.pow(10, Number(m.unit || 0));
            const val = Number(m.value) * factor;
            const keys: Record<number,string> = {1:"weight",5:"fatFreeMass",6:"bodyFat",8:"fatMass",76:"muscleMass",77:"hydration",88:"boneMass"};
            if (keys[m.type]) values[keys[m.type]] = Math.round(val * 10) / 10;
          }
          return { date: new Date(Number(g.date)*1000).toISOString().slice(0,10), ...values };
        });
        return new Response(JSON.stringify({ measures, syncedAt: new Date().toISOString() }), {
          headers: { ...cors, "content-type": "application/json", "cache-control": "no-store" }
        });
      } catch (err) {
        return json({ error: err instanceof Error ? err.message : "Sync failed." }, 502);
      }
    }

    if (url.pathname === "/api/disconnect" && request.method === "POST") {
      await env.DB.prepare("DELETE FROM withings_tokens WHERE id=1").run();
      return json({ disconnected: true });
    }
    return json({ error: "Not found" }, 404);
  }
};
