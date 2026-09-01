export const testConsoleHtml = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="dark">
  <title>Profile Signal — LinkedIn API</title>
  <style>
    :root { --ink:#101b31; --panel:#172540; --panel-2:#1d2e4f; --line:#304564; --paper:#eaf2f9; --muted:#a9bbcf; --aqua:#58e0cf; --coral:#ff846c; --yellow:#f5c86a; }
    * { box-sizing:border-box; }
    body { margin:0; min-height:100vh; color:var(--paper); background:radial-gradient(circle at 85% -10%,#245477 0,transparent 38rem), var(--ink); font:15px/1.5 Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; }
    main { width:min(1120px,calc(100% - 32px)); margin:0 auto; padding:42px 0 72px; }
    .masthead { display:flex; justify-content:space-between; gap:28px; align-items:flex-start; padding-bottom:28px; border-bottom:1px solid var(--line); }
    .eyebrow { margin:0 0 10px; color:var(--aqua); font:700 11px/1 ui-monospace,SFMono-Regular,Menlo,monospace; letter-spacing:.14em; text-transform:uppercase; }
    h1 { margin:0; max-width:680px; font-size:clamp(2.45rem,5vw,4.8rem); line-height:.94; letter-spacing:-.065em; }
    .stamp { min-width:164px; padding:13px 15px; border:1px solid var(--line); border-radius:12px; color:var(--muted); font:12px/1.35 ui-monospace,SFMono-Regular,Menlo,monospace; }
    .stamp strong { display:block; margin-bottom:4px; color:var(--aqua); font-size:11px; letter-spacing:.08em; }
    .deck { max-width:650px; margin:21px 0 32px; color:var(--muted); font-size:17px; }
    .workspace { display:grid; grid-template-columns:minmax(0,1fr) 310px; gap:20px; }
    .card { background:linear-gradient(145deg,rgba(29,46,79,.96),rgba(18,30,51,.96)); border:1px solid var(--line); border-radius:16px; box-shadow:0 22px 60px rgba(0,0,0,.18); }
    .form-card { padding:24px; }
    label { display:block; margin-bottom:9px; font-size:12px; font-weight:750; letter-spacing:.06em; text-transform:uppercase; }
    input { width:100%; border:1px solid #47607f; border-radius:9px; padding:14px 15px; outline:0; color:var(--paper); background:#101d34; font:14px ui-monospace,SFMono-Regular,Menlo,monospace; }
    input:focus { border-color:var(--aqua); box-shadow:0 0 0 3px rgba(88,224,207,.14); }
    .input-row { display:grid; grid-template-columns:minmax(0,1fr) 150px; gap:12px; }
    .api-key { margin-top:15px; }
    .api-key summary { cursor:pointer; color:var(--muted); font-size:13px; }
    .api-key input { margin-top:10px; }
    button { margin-top:18px; width:100%; border:0; border-radius:9px; padding:14px 17px; cursor:pointer; color:#081c1a; background:var(--aqua); font-weight:850; font-size:15px; transition:transform .16s ease,filter .16s ease; }
    button:hover { filter:brightness(1.07); transform:translateY(-1px); }
    button:disabled { cursor:wait; filter:saturate(.35); transform:none; }
    .hint { margin:14px 0 0; color:var(--muted); font-size:13px; }
    .status { display:flex; align-items:center; gap:8px; padding:18px; }
    .dot { width:8px; height:8px; border-radius:50%; background:var(--yellow); box-shadow:0 0 0 4px rgba(245,200,106,.11); }
    .status-ready .dot { background:var(--aqua); box-shadow:0 0 0 4px rgba(88,224,207,.11); }
    .status-copy { margin:0; color:var(--muted); font:12px/1.35 ui-monospace,SFMono-Regular,Menlo,monospace; }
    .status-copy strong { display:block; color:var(--paper); font-size:13px; }
    .guide { padding:22px; }
    .guide h2 { margin:0 0 14px; font-size:16px; letter-spacing:-.02em; }
    .guide ol { margin:0; padding-left:21px; color:var(--muted); font-size:13px; }
    .guide li + li { margin-top:9px; }
    .result { margin-top:20px; overflow:hidden; }
    .result-header { display:flex; align-items:center; justify-content:space-between; gap:16px; padding:16px 20px; border-bottom:1px solid var(--line); }
    .result-header h2 { margin:0; font-size:15px; }
    .badge { padding:5px 8px; border-radius:999px; color:var(--aqua); background:rgba(88,224,207,.12); font:11px ui-monospace,SFMono-Regular,Menlo,monospace; }
    .empty { padding:40px 24px; color:var(--muted); text-align:center; }
    .error { color:#ffd1c7; background:rgba(255,132,108,.1); }
    pre { max-height:560px; margin:0; overflow:auto; padding:20px; color:#d9e7f4; background:#0d1729; font:12px/1.6 ui-monospace,SFMono-Regular,Menlo,monospace; white-space:pre-wrap; word-break:break-word; }
    .summary-grid { display:grid; grid-template-columns:repeat(4,1fr); border-bottom:1px solid var(--line); }
    .metric { min-width:0; padding:15px 20px; border-right:1px solid var(--line); }
    .metric:last-child { border-right:0; }
    .metric b { display:block; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:16px; }
    .metric span { color:var(--muted); font:11px ui-monospace,SFMono-Regular,Menlo,monospace; text-transform:uppercase; }
    @media (max-width:760px) { main { width:min(100% - 24px,1120px); padding-top:28px; } .masthead,.workspace { display:block; } .stamp { margin-top:22px; } .workspace > * + * { margin-top:16px; } .input-row { grid-template-columns:1fr; } .summary-grid { grid-template-columns:repeat(2,1fr); } .metric:nth-child(2) { border-right:0; } .metric:nth-child(n+3) { border-top:1px solid var(--line); } }
    @media (prefers-reduced-motion:reduce) { * { transition:none !important; } }
  </style>
</head>
<body>
  <main>
    <header class="masthead">
      <div><p class="eyebrow">Direct RSC test console</p><h1>Profile signal,<br>not page chrome.</h1></div>
      <div class="stamp"><strong>HTTP ONLY</strong>no browser runtime<br>typed JSON output</div>
    </header>
    <p class="deck">Paste a LinkedIn profile URL and inspect exactly what the configured account can retrieve. Every upstream failure stays visible—no fabricated profile data.</p>
    <section class="workspace">
      <form class="card form-card" id="extract-form">
        <label for="profile-url">LinkedIn profile URL</label>
        <div class="input-row"><input id="profile-url" name="profile_url" type="url" required value="https://www.linkedin.com/in/jainrishi601" placeholder="https://www.linkedin.com/in/example"><button id="submit" type="submit">Extract profile</button></div>
        <p class="hint">Enter only the profile URL. LinkedIn session secrets, cookies, and request headers stay on the backend.</p>
      </form>
      <aside>
        <div class="card status" id="status"><span class="dot"></span><p class="status-copy"><strong>Checking service</strong><span id="status-detail">reading /ready</span></p></div>
        <div class="card guide" style="margin-top:20px"><h2>What to expect</h2><ol><li>Use a public <code>/in/</code> URL.</li><li>Successful fields appear as JSON.</li><li>Unavailable fields stay explicit.</li><li>Session errors mean LinkedIn rejected the configured backend session.</li></ol></div>
      </aside>
    </section>
    <section class="card result" aria-live="polite">
      <div class="result-header"><h2>Response envelope</h2><span class="badge" id="result-badge">WAITING</span></div>
      <div id="result"><p class="empty">Submit a profile URL to run a live extraction.</p></div>
    </section>
  </main>
  <script>
    const status = document.getElementById('status'); const statusDetail = document.getElementById('status-detail');
    const result = document.getElementById('result'); const badge = document.getElementById('result-badge'); const submit = document.getElementById('submit');
    const pretty = (value) => JSON.stringify(value, null, 2);
    async function serviceStatus() { try { const response = await fetch('/ready'); const body = await response.json(); const ready = response.ok && body.status === 'ready'; status.classList.toggle('status-ready', ready); statusDetail.textContent = ready ? 'LinkedIn session ready' : (body.reason || 'not ready'); } catch { statusDetail.textContent = 'service unreachable'; } }
    document.getElementById('extract-form').addEventListener('submit', async (event) => { event.preventDefault(); const profileUrl = document.getElementById('profile-url').value.trim(); submit.disabled = true; submit.textContent = 'Extracting…'; badge.textContent = 'RUNNING'; result.innerHTML = '<p class="empty">Contacting the configured upstream session…</p>';
      try { const response = await fetch('/v1/profiles/extract', { method:'POST', headers:{ 'Content-Type': 'application/json' }, body:JSON.stringify({ profile_url: profileUrl }) }); const body = await response.json();
        if (!response.ok) { badge.textContent = body.error?.code || 'ERROR'; result.innerHTML = '<pre class="error"></pre>'; result.querySelector('pre').textContent = pretty(body); return; }
        const profile = body.data; const metrics = [['Name', profile.name?.full || '—'], ['Experience', String(profile.experience?.length ?? 0)], ['Education', String(profile.education?.length ?? 0)], ['Skills', String(profile.skills?.length ?? 0)]]; badge.textContent = body.meta?.completeness?.toUpperCase() || 'SUCCESS'; result.innerHTML = '<div class="summary-grid">' + metrics.map(([label,value]) => '<div class="metric"><b></b><span></span></div>').join('') + '</div><pre></pre>'; result.querySelectorAll('.metric').forEach((item,index) => { item.querySelector('b').textContent = metrics[index][1]; item.querySelector('span').textContent = metrics[index][0]; }); result.querySelector('pre').textContent = pretty(body);
      } catch (error) { badge.textContent = 'NETWORK ERROR'; result.innerHTML = '<pre class="error"></pre>'; result.querySelector('pre').textContent = String(error); }
      finally { submit.disabled = false; submit.textContent = 'Extract profile'; serviceStatus(); }
    }); serviceStatus();
  </script>
</body></html>`;
