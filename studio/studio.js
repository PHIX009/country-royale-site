// Country Royale Studio: sign in with TikTok, pick a battle, post it.
// Follows TikTok's content-sharing rules: the creator's current info is fetched before posting,
// privacy has no default, interaction settings start off, content disclosure is offered, the
// caption is editable, the video is previewed, and consent is shown above the Post button.
(() => {
  const SERVER = (window.CR_STUDIO?.server || '').replace(/\/$/, '');
  const $ = (id) => document.getElementById(id);
  const store = {
    get(k) { try { return JSON.parse(sessionStorage.getItem('crs.' + k)); } catch { return null; } },
    set(k, v) { try { v == null ? sessionStorage.removeItem('crs.' + k) : sessionStorage.setItem('crs.' + k, JSON.stringify(v)); } catch { /* private mode: lives for this page only */ } },
  };
  let session = store.get('session'); // { env, token, open_id, expires }
  let creator = null, items = [], tab = 'ready';

  const PRIVACY = { PUBLIC_TO_EVERYONE: 'Everyone', MUTUAL_FOLLOW_FRIENDS: 'Friends', FOLLOWER_OF_CREATOR: 'Followers', SELF_ONLY: 'Only me' };
  const MODES = { string_circle: 'String Circle', rope_web: 'Rope Web', weapon_balls: 'Weapon Balls', escape_ring: 'Escape the Ring', line_painter: 'Line Painter' };
  const MUSIC = 'https://www.tiktok.com/legal/page/global/music-usage-confirmation/en';
  const BRANDED = 'https://www.tiktok.com/legal/page/global/bc-policy/en';

  function say(text, bad) { const m = $('msg'); m.textContent = text || ''; m.hidden = !text; m.classList.toggle('bad', !!bad); }

  async function call(path, body) {
    const r = await fetch(SERVER + path, body === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({ error: 'The studio did not answer. Try again.' }));
    if (!r.ok || j.error) { const e = new Error(j.error || `Error ${r.status}`); e.status = r.status; throw e; }
    return j;
  }

  // ---- sign-in -------------------------------------------------------------------------------
  async function signIn() {
    const cfg = await call('/config');
    const state = 'studio.' + crypto.getRandomValues(new Uint32Array(3)).join('');
    store.set('oauth', { state, env: cfg.env });
    location.href = 'https://www.tiktok.com/v2/auth/authorize/?' + new URLSearchParams({ client_key: cfg.client_key, scope: cfg.scope, response_type: 'code', redirect_uri: cfg.redirect_uri, state });
  }

  async function finishSignIn(q) {
    const o = store.get('oauth'); store.set('oauth', null);
    history.replaceState(null, '', location.pathname);
    if (q.get('error')) throw new Error(q.get('error_description') || 'TikTok sign-in was cancelled.');
    if (!o || q.get('state') !== o.state) throw new Error('That sign-in link is stale. Sign in again.');
    const t = await call('/token', { env: o.env, code: q.get('code') });
    session = { env: o.env, token: t.access_token, open_id: t.open_id, expires: Date.now() + (t.expires_in - 60) * 1000 };
    store.set('session', session);
  }

  function signOut() { session = null; creator = null; store.set('session', null); render(); }

  // ---- data ----------------------------------------------------------------------------------
  async function load() {
    say('Loading…');
    creator = await call('/creator', { env: session.env, token: session.token });
    items = (await call('/queue', { open_id: session.open_id })).items;
    say('');
  }

  // ---- view ----------------------------------------------------------------------------------
  function render() {
    const inSide = !!(session && creator);
    $('signedOut').hidden = inSide; $('signedIn').hidden = !inSide; $('who').hidden = !inSide;
    if (!inSide) return;
    $('nick').textContent = creator.creator_nickname || creator.creator_username || 'you';
    $('avatar').src = creator.creator_avatar_url || '../logo.png';
    const lim = $('limits');
    lim.hidden = !creator.max_video_post_duration_sec;
    const max = creator.max_video_post_duration_sec;
    lim.textContent = `Your account can post videos up to ${max >= 60 ? Math.floor(max / 60) + ' min' : max + ' s'} long.`;

    // ready: oldest first, so posting top to bottom keeps the story in order; posted: newest first
    const ready = items.filter((i) => !i.posted).sort((a, b) => a.added.localeCompare(b.added));
    const posted = items.filter((i) => i.posted).sort((a, b) => b.added.localeCompare(a.added));
    $('nReady').textContent = ready.length; $('nPosted').textContent = posted.length;
    document.querySelectorAll('.tab').forEach((t) => t.setAttribute('aria-selected', String(t.dataset.tab === tab)));
    const shown = tab === 'ready' ? ready : posted;
    const list = $('list'); list.replaceChildren(...shown.map(card));
    $('empty').hidden = shown.length > 0;
    $('empty').textContent = tab === 'ready' ? 'Every battle is posted. New ones appear here after each match.' : 'Nothing posted from here yet.';
  }

  function card(it) {
    const el = $('card').content.firstElementChild.cloneNode(true);
    const q = (s) => el.querySelector(s);
    const v = q('video'); v.poster = it.cover; v.src = it.video;
    q('.title').textContent = it.title;
    q('.meta').textContent = [it.nations?.length ? `${it.nations.length} nations` : '', MODES[it.mode] || '', `${Math.round(it.duration)} s`].filter(Boolean).join(' · ');
    const cap = q('.caption'), count = q('.count');
    cap.value = it.caption;
    const sel = q('.privacy');
    for (const p of creator.privacy_level_options || []) sel.add(new Option(PRIVACY[p] || p, p));
    const off = [];
    el.querySelectorAll('.allow').forEach((c) => {
      if (creator[`${c.dataset.k}_disabled`]) { c.disabled = true; off.push(c.parentElement.textContent.trim()); }
    });
    if (off.length) { const n = q('.off-note'); n.hidden = false; n.textContent = `${off.join(', ')} ${off.length > 1 ? 'are' : 'is'} turned off in your TikTok settings.`; }

    const dc = q('.dc'), own = q('.dc-own'), paid = q('.dc-paid'), post = q('.post');
    function update() {
      count.textContent = `${cap.value.length} / 2200`;
      q('.dc-opts').hidden = !dc.checked;
      // branded content cannot be private
      const onlyMe = [...sel.options].find((o) => o.value === 'SELF_ONLY');
      if (onlyMe) { onlyMe.disabled = dc.checked && paid.checked; onlyMe.textContent = onlyMe.disabled ? 'Only me (not available for branded content)' : 'Only me'; }
      if (onlyMe?.disabled && sel.value === 'SELF_ONLY') sel.value = '';
      const label = q('.dc-label');
      label.textContent = !dc.checked ? '' : paid.checked ? 'Your video will be labeled “Paid partnership”. This cannot be changed once your video is posted.'
        : own.checked ? 'Your video will be labeled “Promotional content”. This cannot be changed once your video is posted.' : '';
      const branded = dc.checked && paid.checked;
      q('.consent').innerHTML = branded
        ? `By posting, you agree to TikTok's <a href="${BRANDED}" target="_blank" rel="noopener">Branded Content Policy</a> and <a href="${MUSIC}" target="_blank" rel="noopener">Music Usage Confirmation</a>.`
        : `By posting, you agree to TikTok's <a href="${MUSIC}" target="_blank" rel="noopener">Music Usage Confirmation</a>.`;
      let problem = '';
      if (creator.max_video_post_duration_sec && it.duration > creator.max_video_post_duration_sec) problem = 'This video is longer than your account can post.';
      else if (dc.checked && !own.checked && !paid.checked) problem = 'You need to indicate if your content promotes yourself, a third party, or both.';
      const p = q('.problem'); p.hidden = !problem; p.textContent = problem;
      post.disabled = !!problem || !sel.value || !cap.value.trim() || el.classList.contains('busy');
    }
    [cap, sel, dc, own, paid].forEach((x) => x.addEventListener('input', update));
    [dc, own, paid].forEach((x) => x.addEventListener('change', update));
    update();
    post.addEventListener('click', () => publish(it, el, update));
    if (it.posted) { el.classList.add('done'); const r = q('.result'); r.hidden = false; r.className = 'result ok'; r.textContent = 'Posted from Country Royale Studio.'; }
    return el;
  }

  async function publish(it, el, update) {
    const q = (s) => el.querySelector(s);
    const res = q('.result'), post = q('.post');
    const allow = (k) => q(`.allow[data-k="${k}"]`).checked;
    el.classList.add('busy'); post.disabled = true; post.textContent = 'Uploading to TikTok…';
    res.hidden = false; res.className = 'result'; res.textContent = 'Sending the video to TikTok. Keep this page open.';
    try {
      const fresh = await call('/creator', { env: session.env, token: session.token }); // TikTok: latest creator info at post time
      creator = { ...creator, ...fresh };
      const { publish_id } = await call('/publish', {
        env: session.env, token: session.token, open_id: session.open_id, key: it.key,
        title: q('.caption').value, privacy_level: q('.privacy').value,
        disable_comment: !allow('comment'), disable_duet: !allow('duet'), disable_stitch: !allow('stitch'),
        brand_content_toggle: q('.dc').checked && q('.dc-paid').checked, brand_organic_toggle: q('.dc').checked && q('.dc-own').checked,
      });
      res.textContent = 'Uploaded. TikTok is processing it…';
      let status = '';
      for (let k = 0; k < 24 && !/COMPLETE|FAILED/.test(status); k++) {
        await new Promise((r) => setTimeout(r, 5000));
        const s = await call('/status', { env: session.env, token: session.token, publish_id }).catch(() => ({}));
        status = s.status || status;
        if (s.fail_reason) throw new Error(`TikTok could not post it: ${s.fail_reason}`);
      }
      it.posted = true; el.classList.add('done');
      res.className = 'result ok';
      res.textContent = 'Posted. It can take a few minutes for the video to appear on your TikTok profile.';
      $('nReady').textContent = items.filter((i) => !i.posted).length; $('nPosted').textContent = items.filter((i) => i.posted).length;
    } catch (e) {
      res.className = 'result bad'; res.textContent = e.message;
      if (e.status === 401) { signOut(); say(e.message, true); }
    } finally {
      el.classList.remove('busy'); post.textContent = 'Post to TikTok'; update();
    }
  }

  // ---- start ---------------------------------------------------------------------------------
  $('signin').addEventListener('click', () => signIn().catch((e) => say(e.message, true)));
  $('signout').addEventListener('click', signOut);
  document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => { tab = t.dataset.tab; render(); }));

  (async () => {
    try {
      const q = new URLSearchParams(location.search);
      if (q.get('code') || q.get('error')) await finishSignIn(q);
      if (session && session.expires < Date.now()) { session = null; store.set('session', null); }
      if (session) await load();
    } catch (e) {
      if (e.status === 401) { session = null; store.set('session', null); }
      say(e.message, true);
    }
    render();
  })();
})();
