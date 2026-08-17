// FootDelegue — logique applicative branchée sur Supabase (auth + base de données partagée)

const FORMATS = { '5v5': 5, '8v8': 8 };
const MATERIEL_DEFAUT = ['Vareuses', 'Gourdes', 'Collation / sandwichs'];
const AUTOSAVE_MS = 10000;

function showFatalError(message) {
  const el = document.getElementById('auth-error');
  if (el) el.textContent = 'Erreur technique : ' + message;
}
window.addEventListener('error', (e) => showFatalError(e.message));
window.addEventListener('unhandledrejection', (e) => showFatalError(e.reason?.message || String(e.reason)));

if (!window.supabase) showFatalError("la bibliothèque Supabase n'a pas pu se charger (vendor/supabase.js).");
const supabase = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} : pas de réponse après ${ms / 1000}s (problème réseau probable)`)), ms)),
  ]);
}

let state = { teams: [], players: [], matches: [], tasks: [], currentTeamId: null, currentMatchId: null };
let selectedPlayerId = null; // pour la substitution par sélection + clic
let tickInterval = null;
let autosaveInterval = null;
let pendingMatchSave = false;

function uid() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

function currentTeam() {
  return state.teams.find(t => t.id === state.currentTeamId) || null;
}
function teamPlayers(teamId) {
  return state.players.filter(p => p.teamId === teamId);
}
function currentMatch() {
  return state.matches.find(m => m.id === state.currentMatchId) || null;
}

// ---------- Authentification ----------
function dlog(msg) {
  const el = document.getElementById('debug-log');
  if (el) el.textContent += new Date().toLocaleTimeString() + ' — ' + msg + '\n';
}

function initAuth() {
  dlog('initAuth: attache les boutons');
  // Les boutons sont rendus cliquables tout de suite, sans attendre le réseau.
  document.getElementById('auth-signin').addEventListener('click', () => doAuth('signInWithPassword'));
  document.getElementById('auth-signup').addEventListener('click', () => doAuth('signUp'));
  document.getElementById('btn-logout').addEventListener('click', () => supabase.auth.signOut());

  supabase.auth.onAuthStateChange((event, session) => {
    dlog('changement de session : ' + event);
    if (event === 'SIGNED_IN' && session) onLoggedIn();
    if (event === 'SIGNED_OUT') showAuthScreen();
  });

  dlog('verification d\'une session existante...');
  withTimeout(supabase.auth.getSession(), 12000, 'Vérification de session')
    .then(({ data: { session } }) => {
      dlog('session verifiee : ' + (session ? 'connecte' : 'aucune'));
      if (session) onLoggedIn(); else showAuthScreen();
    })
    .catch((err) => { dlog('erreur session : ' + err.message); showAuthScreen(); });
}

async function doAuth(method) {
  const email = document.getElementById('auth-email').value.trim();
  const password = document.getElementById('auth-password').value;
  const errEl = document.getElementById('auth-error');
  errEl.textContent = '';
  dlog((method === 'signUp' ? 'creation de compte' : 'connexion') + ' en cours pour ' + email);
  if (!email || !password) { errEl.textContent = 'Email et mot de passe requis.'; return; }
  try {
    const { error } = await withTimeout(supabase.auth[method]({ email, password }), 15000, 'Requête');
    if (error) { dlog('reponse avec erreur : ' + error.message); errEl.textContent = error.message; }
    else if (method === 'signUp') { dlog('compte cree'); errEl.textContent = 'Compte créé. Vérifie tes emails si une confirmation est demandée, puis connecte-toi.'; }
    else dlog('connexion reussie');
  } catch (err) {
    dlog('exception : ' + err.message);
    errEl.textContent = err.message;
  }
}

function showAuthScreen() {
  document.getElementById('auth').classList.remove('hidden');
  document.getElementById('app').classList.add('hidden');
}

async function onLoggedIn() {
  document.getElementById('auth').classList.add('hidden');
  document.getElementById('app').classList.remove('hidden');
  await loadTeams();
  showPage('accueil');
}

// ---------- Chargement depuis Supabase ----------
async function loadTeams() {
  const { data, error } = await supabase.from('teams').select('*').order('created_at');
  if (error) { alert('Erreur de chargement des équipes : ' + error.message); return; }
  state.teams = data.map(t => ({ id: t.id, name: t.name, format: t.format, materiel: t.materiel || [] }));
  if (!state.currentTeamId && state.teams.length) state.currentTeamId = state.teams[0].id;
}

async function loadTeamData(teamId) {
  const [playersRes, matchesRes, tasksRes] = await Promise.all([
    supabase.from('players').select('*').eq('team_id', teamId).order('created_at'),
    supabase.from('matches').select('*').eq('team_id', teamId).order('date'),
    supabase.from('tasks').select('*').eq('team_id', teamId).order('created_at'),
  ]);
  state.players = state.players.filter(p => p.teamId !== teamId).concat(
    (playersRes.data || []).map(p => ({ id: p.id, teamId: p.team_id, name: p.name }))
  );
  state.matches = state.matches.filter(m => m.teamId !== teamId).concat(
    (matchesRes.data || []).map(rowToMatch)
  );
  state.tasks = state.tasks.filter(t => t.teamId !== teamId).concat(
    (tasksRes.data || []).map(t => ({ id: t.id, teamId: t.team_id, label: t.label, responsable: t.responsable || '', done: t.done }))
  );
}

function rowToMatch(row) {
  const d = row.data || {};
  return {
    id: row.id, teamId: row.team_id, opponent: row.opponent, date: row.date, status: row.status,
    heureRdv: d.heureRdv || '', heureMatch: d.heureMatch || '', lieu: d.lieu || '',
    maillot: d.maillot || '', meteo: d.meteo || '', contact: d.contact || '',
    scoreNous: d.scoreNous || 0, scoreEux: d.scoreEux || 0, chronoSec: d.chronoSec || 0,
    paused: d.paused || false, events: d.events || [], remarkGeneral: d.remarkGeneral || '',
    playerRemarks: d.playerRemarks || {}, matchPlayers: d.matchPlayers || {},
  };
}

function matchToRow(m) {
  return {
    id: m.id, team_id: m.teamId, opponent: m.opponent, date: m.date || null, status: m.status,
    data: {
      heureRdv: m.heureRdv, heureMatch: m.heureMatch, lieu: m.lieu, maillot: m.maillot,
      meteo: m.meteo, contact: m.contact, scoreNous: m.scoreNous, scoreEux: m.scoreEux,
      chronoSec: m.chronoSec, paused: m.paused, events: m.events, remarkGeneral: m.remarkGeneral,
      playerRemarks: m.playerRemarks, matchPlayers: m.matchPlayers,
    },
  };
}

async function saveMatch(match) {
  const { error } = await supabase.from('matches').upsert(matchToRow(match));
  if (error) console.error('Sauvegarde match échouée', error.message);
}
async function saveTeamMateriel(team) {
  const { error } = await supabase.from('teams').update({ materiel: team.materiel }).eq('id', team.id);
  if (error) console.error('Sauvegarde matériel échouée', error.message);
}

// ---------- Navigation ----------
const pages = ['accueil', 'match', 'materiel', 'taches', 'historique'];

async function showPage(name) {
  pages.forEach(p => {
    document.getElementById('page-' + p).classList.toggle('hidden', p !== name);
  });
  document.querySelectorAll('.bottom-nav button').forEach(b => {
    b.classList.toggle('active', b.dataset.page === name);
  });
  if (currentTeam() && name !== 'accueil') await loadTeamData(state.currentTeamId);
  render(name);
}

function render(name) {
  if (name === 'accueil') renderAccueil();
  if (name === 'match') renderMatch();
  if (name === 'materiel') renderMateriel();
  if (name === 'taches') renderTaches();
  if (name === 'historique') renderHistorique();
}

// ---------- Accueil : équipes + matchs à venir ----------
async function renderAccueil() {
  const el = document.getElementById('page-accueil');
  el.innerHTML = '<p class="empty-state">Chargement…</p>';
  if (state.currentTeamId) await loadTeamData(state.currentTeamId);
  const team = currentTeam();

  let html = '<h2>Équipes</h2><div class="card">';
  if (state.teams.length === 0) {
    html += '<p class="empty-state">Aucune équipe pour l\'instant.</p>';
  } else {
    state.teams.forEach(t => {
      html += `<div class="row">
        <div class="row-main">
          <div class="title">${escapeHtml(t.name)}</div>
          <div class="subtitle">${t.format} · ${teamPlayers(t.id).length} joueur(s)</div>
        </div>
        <button data-action="select-team" data-id="${t.id}" class="${t.id === state.currentTeamId ? 'primary' : 'ghost'}">
          ${t.id === state.currentTeamId ? 'Active' : 'Choisir'}
        </button>
      </div>`;
    });
  }
  html += '</div><button data-action="new-team" class="primary" style="width:100%">+ Nouvelle équipe</button>';

  if (team) {
    html += `<h2 style="margin-top:24px">Joueurs — ${escapeHtml(team.name)}</h2><div class="card">`;
    const players = teamPlayers(team.id);
    if (players.length === 0) {
      html += '<p class="empty-state">Aucun joueur.</p>';
    } else {
      players.forEach(p => {
        html += `<div class="row">
          <div class="row-main"><div class="title">${escapeHtml(p.name)}</div></div>
          <button data-action="remove-player" data-id="${p.id}" class="ghost">Retirer</button>
        </div>`;
      });
    }
    html += '</div><button data-action="new-player" class="ghost" style="width:100%">+ Ajouter un joueur</button>';

    html += `<h2 style="margin-top:24px">Matchs — ${escapeHtml(team.name)}</h2><div class="card">`;
    const matches = state.matches.filter(m => m.teamId === team.id && m.status !== 'termine').sort((a, b) => (a.date || '').localeCompare(b.date || ''));
    if (matches.length === 0) {
      html += '<p class="empty-state">Aucun match programmé.</p>';
    } else {
      matches.forEach(m => {
        html += `<div class="row">
          <div class="row-main">
            <div class="title">${escapeHtml(m.opponent || 'Adversaire ?')}</div>
            <div class="subtitle">${m.date || ''} ${m.heureMatch || ''} · ${statusLabel(m.status)}</div>
          </div>
          <button data-action="open-match" data-id="${m.id}" class="primary">Ouvrir</button>
        </div>`;
      });
    }
    html += '</div><button data-action="new-match" class="primary" style="width:100%">+ Nouveau match</button>';
  }

  el.innerHTML = html;
}

function statusLabel(s) {
  return { prevu: 'à venir', en_cours: 'en cours', termine: 'terminé' }[s] || s;
}

// ---------- Match : avant-match + live + résumé ----------
function renderMatch() {
  const el = document.getElementById('page-match');
  const match = currentMatch();
  if (!match) {
    el.innerHTML = '<p class="empty-state">Sélectionne ou crée un match depuis l\'accueil.</p>';
    return;
  }

  if (match.status === 'termine') {
    el.innerHTML = renderMatchSummary(match);
    return;
  }

  let html = renderAvantMatchForm(match);

  if (match.status === 'prevu') {
    html += `<button data-action="start-match" class="primary" style="width:100%;margin-top:16px">Démarrer le match</button>`;
  } else if (match.status === 'en_cours') {
    html += renderLiveMatch(match);
  }

  el.innerHTML = html;
  if (match.status === 'en_cours') attachPitchHandlers(match);
}

function renderAvantMatchForm(match) {
  return `<div class="card">
    <h3>Avant-match</h3>
    <label>Adversaire</label>
    <input type="text" data-field="opponent" value="${escapeAttr(match.opponent)}" ${match.status !== 'prevu' ? 'readonly' : ''}>
    <label>Date</label>
    <input type="date" data-field="date" value="${escapeAttr(match.date)}" ${match.status !== 'prevu' ? 'readonly' : ''}>
    <label>Heure de rendez-vous</label>
    <input type="time" data-field="heureRdv" value="${escapeAttr(match.heureRdv)}">
    <label>Heure du match</label>
    <input type="time" data-field="heureMatch" value="${escapeAttr(match.heureMatch)}">
    <label>Lieu</label>
    <input type="text" data-field="lieu" value="${escapeAttr(match.lieu)}">
    <label>Couleur de maillot</label>
    <input type="text" data-field="maillot" value="${escapeAttr(match.maillot)}" placeholder="ex: maillot vert">
    <label>Météo</label>
    <input type="text" data-field="meteo" value="${escapeAttr(match.meteo)}" placeholder="ex: pluie, prévoir k-way">
    <label>Contact utile</label>
    <input type="text" data-field="contact" value="${escapeAttr(match.contact)}" placeholder="nom + téléphone">
  </div>`;
}

function renderLiveMatch(match) {
  const team = currentTeam();
  const players = teamPlayers(team.id);
  const onField = players.filter(p => match.matchPlayers[p.id]?.onField);
  const onBench = players.filter(p => !match.matchPlayers[p.id]?.onField);

  let html = `<div class="card">
    <div class="scoreboard">
      <span>${match.scoreNous}</span><span class="vs">vs</span><span>${match.scoreEux}</span>
    </div>
    <div class="chrono">Temps de match : ${formatMMSS(match.chronoSec || 0)}${match.paused ? ' (pause)' : ''}</div>
    <div class="match-actions">
      <button data-action="but-nous" class="primary">+1 nous</button>
      <button data-action="but-eux" class="danger">+1 eux</button>
      <button data-action="toggle-pause" class="ghost">${match.paused ? 'Reprendre' : 'Pause'}</button>
      <button data-action="end-match" class="ghost">Terminer le match</button>
    </div>
  </div>

  <div class="card">
    <h3>Terrain</h3>
    <div class="pitch" id="pitch">
      ${onField.map(p => playerChipHtml(p, match, true)).join('')}
    </div>
    <div class="bench-section">
      <h4>Banc</h4>
      <div class="bench-list" id="bench">
        ${onBench.length ? onBench.map(p => playerChipHtml(p, match, false)).join('') : '<span class="subtitle">Personne sur le banc</span>'}
      </div>
    </div>
    <p class="subtitle" style="margin-top:10px">Sélectionne un joueur puis touche un autre joueur pour les faire changer de statut (terrain ↔ banc).</p>
  </div>

  <div class="card">
    <h3>Remarque générale</h3>
    <textarea data-field="remarkGeneral" placeholder="Notes sur le match">${escapeHtml(match.remarkGeneral || '')}</textarea>
  </div>

  <div class="card">
    <h3>Remarques par joueur (facultatif)</h3>
    ${players.map(p => `
      <label>${escapeHtml(p.name)}</label>
      <textarea data-player-remark="${p.id}" placeholder="Remarque pour ${escapeAttr(p.name)}">${escapeHtml(match.playerRemarks[p.id] || '')}</textarea>
    `).join('')}
  </div>`;

  return html;
}

function playerChipHtml(p, match, isField) {
  const mp = match.matchPlayers[p.id] || { currentStintSec: 0 };
  const selected = selectedPlayerId === p.id;
  return `<div class="player-chip ${selected ? 'selected' : ''}" data-player-id="${p.id}">
    <div class="avatar" style="background:${colorFor(p.name)}">${initials(p.name)}</div>
    <div class="name">${escapeHtml(p.name)}</div>
    <div class="stint">${formatMMSS(mp.currentStintSec)}</div>
  </div>`;
}

function attachPitchHandlers(match) {
  document.querySelectorAll('#pitch .player-chip, #bench .player-chip').forEach(chip => {
    chip.addEventListener('click', () => onPlayerChipClick(chip.dataset.playerId, match));
  });
}

function onPlayerChipClick(playerId, match) {
  if (!selectedPlayerId) {
    selectedPlayerId = playerId;
    renderMatch();
    return;
  }
  if (selectedPlayerId === playerId) {
    selectedPlayerId = null;
    renderMatch();
    return;
  }
  const a = match.matchPlayers[selectedPlayerId];
  const b = match.matchPlayers[playerId];
  if (a.onField === b.onField) {
    // même statut : pas d'échange possible, on change juste la sélection
    selectedPlayerId = playerId;
    renderMatch();
    return;
  }
  swapPlayers(match, selectedPlayerId, playerId);
  selectedPlayerId = null;
  saveMatch(match);
  renderMatch();
}

function swapPlayers(match, idOut, idIn) {
  const out = match.matchPlayers[idOut];
  const inn = match.matchPlayers[idIn];
  // "out" est celui qui était sur le terrain (le vérifier au cas où l'ordre soit inversé)
  const fieldPlayer = out.onField ? out : inn;
  const benchPlayer = out.onField ? inn : out;

  fieldPlayer.totalFieldSec += fieldPlayer.currentStintSec;
  fieldPlayer.currentStintSec = 0;
  fieldPlayer.onField = false;

  benchPlayer.totalBenchSec += benchPlayer.currentStintSec;
  benchPlayer.currentStintSec = 0;
  benchPlayer.onField = true;

  match.events.push({ t: match.chronoSec || 0, type: 'sub', outId: fieldPlayer === out ? idOut : idIn, inId: fieldPlayer === out ? idIn : idOut });
}

function renderMatchSummary(match) {
  const team = currentTeam();
  const players = teamPlayers(team.id);
  let html = `<div class="card">
    <h3>${escapeHtml(match.opponent || 'Match')} — ${match.date || ''}</h3>
    <div class="scoreboard"><span>${match.scoreNous}</span><span class="vs">vs</span><span>${match.scoreEux}</span></div>
    <p class="subtitle">${match.lieu || ''}</p>
  </div>
  <div class="card">
    <h3>Temps de jeu total</h3>
    ${players.map(p => {
      const mp = match.matchPlayers[p.id];
      if (!mp) return '';
      return `<div class="row"><div class="row-main"><div class="title">${escapeHtml(p.name)}</div></div>
        <div class="subtitle">Terrain ${formatMMSS(mp.totalFieldSec)} · Banc ${formatMMSS(mp.totalBenchSec)}</div></div>`;
    }).join('')}
  </div>`;
  if (match.remarkGeneral) {
    html += `<div class="card"><h3>Remarque générale</h3><p>${escapeHtml(match.remarkGeneral)}</p></div>`;
  }
  const remarks = Object.entries(match.playerRemarks || {}).filter(([, v]) => v && v.trim());
  if (remarks.length) {
    html += `<div class="card"><h3>Remarques joueurs</h3>${remarks.map(([pid, txt]) => {
      const p = players.find(pp => pp.id === pid);
      return `<div class="row"><div class="row-main"><div class="title">${escapeHtml(p ? p.name : '?')}</div><div class="subtitle">${escapeHtml(txt)}</div></div></div>`;
    }).join('')}</div>`;
  }
  html += `<button data-action="export-match" data-id="${match.id}" class="primary" style="width:100%">Exporter le résumé (WhatsApp)</button>`;
  return html;
}

// ---------- Matériel ----------
function renderMateriel() {
  const el = document.getElementById('page-materiel');
  const team = currentTeam();
  if (!team) { el.innerHTML = '<p class="empty-state">Choisis une équipe depuis l\'accueil.</p>'; return; }
  if (!team.materiel || !team.materiel.length) team.materiel = MATERIEL_DEFAUT.map(label => ({ id: uid(), label, responsable: '', done: false }));

  let html = `<h2>Matériel — ${escapeHtml(team.name)}</h2><div class="card list-table">`;
  team.materiel.forEach(item => {
    html += `<div class="row">
      <div class="row-main">
        <input type="text" data-materiel-label="${item.id}" value="${escapeAttr(item.label)}">
        <input type="text" data-materiel-resp="${item.id}" value="${escapeAttr(item.responsable)}" placeholder="Responsable">
      </div>
      <label style="display:flex;align-items:center;gap:8px;width:auto;min-width:auto">
        <input type="checkbox" data-materiel-done="${item.id}" ${item.done ? 'checked' : ''} style="width:24px;min-height:24px">
      </label>
      <button data-action="remove-materiel" data-id="${item.id}" class="ghost">✕</button>
    </div>`;
  });
  html += '</div><button data-action="add-materiel" class="ghost" style="width:100%">+ Ajouter un élément</button>';
  el.innerHTML = html;
}

// ---------- Tâches ----------
function renderTaches() {
  const el = document.getElementById('page-taches');
  const team = currentTeam();
  if (!team) { el.innerHTML = '<p class="empty-state">Choisis une équipe depuis l\'accueil.</p>'; return; }
  const tasks = state.tasks.filter(t => t.teamId === team.id);

  let html = `<h2>Tâches — ${escapeHtml(team.name)}</h2><div class="card list-table">`;
  if (tasks.length === 0) html += '<p class="empty-state">Aucune tâche.</p>';
  tasks.forEach(t => {
    html += `<div class="row">
      <div class="row-main">
        <input type="text" data-task-label="${t.id}" value="${escapeAttr(t.label)}">
        <input type="text" data-task-resp="${t.id}" value="${escapeAttr(t.responsable)}" placeholder="Responsable">
      </div>
      <button data-action="toggle-task" data-id="${t.id}" class="${t.done ? 'primary' : 'ghost'}">${t.done ? 'Fait' : 'À faire'}</button>
      <button data-action="remove-task" data-id="${t.id}" class="ghost">✕</button>
    </div>`;
  });
  html += '</div><button data-action="add-task" class="ghost" style="width:100%">+ Ajouter une tâche</button>';
  el.innerHTML = html;
}

// ---------- Historique ----------
function renderHistorique() {
  const el = document.getElementById('page-historique');
  const team = currentTeam();
  if (!team) { el.innerHTML = '<p class="empty-state">Choisis une équipe depuis l\'accueil.</p>'; return; }
  const matches = state.matches.filter(m => m.teamId === team.id && m.status === 'termine').sort((a, b) => (b.date || '').localeCompare(a.date || ''));

  let html = `<h2>Historique — ${escapeHtml(team.name)}</h2><div class="card">`;
  if (matches.length === 0) html += '<p class="empty-state">Aucun match terminé.</p>';
  matches.forEach(m => {
    html += `<div class="row">
      <div class="row-main">
        <div class="title">${escapeHtml(m.opponent || 'Match')} — ${m.scoreNous} / ${m.scoreEux}</div>
        <div class="subtitle">${m.date || ''}</div>
      </div>
      <button data-action="open-match" data-id="${m.id}" class="ghost">Voir</button>
    </div>`;
  });
  html += '</div>';
  el.innerHTML = html;
}

// ---------- Export résumé WhatsApp ----------
function buildExportText(match) {
  const team = currentTeam();
  const players = teamPlayers(team.id);
  let lines = [];
  lines.push(`⚽ ${team.name} vs ${match.opponent || '?'} — ${match.date || ''}`);
  lines.push(`Score : ${match.scoreNous} - ${match.scoreEux}`);
  lines.push('');
  lines.push('Temps de jeu :');
  players.forEach(p => {
    const mp = match.matchPlayers[p.id];
    if (!mp) return;
    lines.push(`- ${p.name} : ${formatMMSS(mp.totalFieldSec)} terrain / ${formatMMSS(mp.totalBenchSec)} banc`);
  });
  if (match.remarkGeneral) {
    lines.push('');
    lines.push(`Remarque : ${match.remarkGeneral}`);
  }
  const remarks = Object.entries(match.playerRemarks || {}).filter(([, v]) => v && v.trim());
  if (remarks.length) {
    lines.push('');
    lines.push('Remarques joueurs :');
    remarks.forEach(([pid, txt]) => {
      const p = players.find(pp => pp.id === pid);
      lines.push(`- ${p ? p.name : '?'} : ${txt}`);
    });
  }
  return lines.join('\n');
}

async function exportMatch(matchId) {
  const match = state.matches.find(m => m.id === matchId);
  if (!match) return;
  const text = buildExportText(match);
  if (navigator.share) {
    try { await navigator.share({ text }); return; } catch (e) { /* annulé par l'utilisateur */ }
  }
  try {
    await navigator.clipboard.writeText(text);
    alert('Résumé copié dans le presse-papier, prêt à coller sur WhatsApp.');
  } catch (e) {
    prompt('Copie ce texte :', text);
  }
}

// ---------- Utilitaires d'affichage ----------
function formatMMSS(totalSec) {
  totalSec = Math.max(0, Math.round(totalSec || 0));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
function initials(name) {
  return (name || '?').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
}
const PALETTE = ['#f87171', '#fb923c', '#facc15', '#4ade80', '#38bdf8', '#a78bfa'];
function colorFor(name) {
  let h = 0;
  for (const c of (name || '')) h = (h * 31 + c.charCodeAt(0)) % PALETTE.length;
  return PALETTE[h];
}
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function escapeAttr(s) { return escapeHtml(s); }

// ---------- Modales génériques ----------
function openModal(title, fieldsHtml, onSubmit) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `<div class="modal">
    <h3>${escapeHtml(title)}</h3>
    ${fieldsHtml}
    <div class="modal-actions">
      <button data-modal-cancel class="ghost">Annuler</button>
      <button data-modal-ok class="primary">Valider</button>
    </div>
  </div>`;
  document.body.appendChild(overlay);
  overlay.querySelector('[data-modal-cancel]').onclick = () => overlay.remove();
  overlay.querySelector('[data-modal-ok]').onclick = () => {
    onSubmit(overlay);
    overlay.remove();
  };
  return overlay;
}

function newTeamModal() {
  openModal('Nouvelle équipe', `
    <label>Nom de l'équipe</label>
    <input type="text" id="m-team-name" placeholder="ex: U10 Rouge">
    <label>Format</label>
    <select id="m-team-format">
      <option value="5v5">5 contre 5</option>
      <option value="8v8">8 contre 8</option>
    </select>
  `, async (overlay) => {
    const name = overlay.querySelector('#m-team-name').value.trim();
    if (!name) return;
    const format = overlay.querySelector('#m-team-format').value;
    const materiel = MATERIEL_DEFAUT.map(label => ({ id: uid(), label, responsable: '', done: false }));
    const { data, error } = await supabase.from('teams').insert({ name, format, materiel }).select().single();
    if (error) { alert('Erreur : ' + error.message); return; }
    state.teams.push({ id: data.id, name: data.name, format: data.format, materiel: data.materiel });
    state.currentTeamId = data.id;
    showPage('accueil');
  });
}

function newPlayerModal() {
  openModal('Nouveau joueur', `
    <label>Nom du joueur</label>
    <input type="text" id="m-player-name" placeholder="Prénom Nom">
  `, async (overlay) => {
    const name = overlay.querySelector('#m-player-name').value.trim();
    if (!name) return;
    const { data, error } = await supabase.from('players').insert({ team_id: state.currentTeamId, name }).select().single();
    if (error) { alert('Erreur : ' + error.message); return; }
    state.players.push({ id: data.id, teamId: data.team_id, name: data.name });
    showPage('accueil');
  });
}

function newMatchModal() {
  openModal('Nouveau match', `
    <label>Adversaire</label>
    <input type="text" id="m-match-opp" placeholder="Nom de l'équipe adverse">
    <label>Date</label>
    <input type="date" id="m-match-date">
  `, async (overlay) => {
    const opponent = overlay.querySelector('#m-match-opp').value.trim();
    const date = overlay.querySelector('#m-match-date').value;
    const match = {
      id: uid(), teamId: state.currentTeamId, opponent, date,
      heureRdv: '', heureMatch: '', lieu: '', maillot: '', meteo: '', contact: '',
      status: 'prevu', scoreNous: 0, scoreEux: 0, chronoSec: 0, paused: false,
      events: [], remarkGeneral: '', playerRemarks: {}, matchPlayers: {}
    };
    const { error } = await supabase.from('matches').insert(matchToRow(match));
    if (error) { alert('Erreur : ' + error.message); return; }
    state.matches.push(match);
    state.currentMatchId = match.id;
    showPage('match');
  });
}

function startMatchModal(match) {
  const team = currentTeam();
  const players = teamPlayers(team.id);
  const slots = FORMATS[team.format] || 5;
  const fieldsHtml = `<p class="subtitle">Sélectionne les ${slots} joueurs qui commencent sur le terrain.</p>
    <div id="m-lineup">
      ${players.map(p => `<label style="display:flex;align-items:center;gap:10px;margin:8px 0">
        <input type="checkbox" data-lineup="${p.id}" style="width:24px;min-height:24px">
        ${escapeHtml(p.name)}
      </label>`).join('')}
    </div>`;
  openModal('Composition de départ', fieldsHtml, async (overlay) => {
    const checked = [...overlay.querySelectorAll('[data-lineup]:checked')].map(i => i.dataset.lineup);
    players.forEach(p => {
      match.matchPlayers[p.id] = {
        onField: checked.includes(p.id),
        currentStintSec: 0, totalFieldSec: 0, totalBenchSec: 0
      };
    });
    match.status = 'en_cours';
    await saveMatch(match);
    startTicking();
    showPage('match');
  });
}

// ---------- Timer global ----------
function startTicking() {
  stopTicking();
  tickInterval = setInterval(() => {
    const match = currentMatch();
    if (!match || match.status !== 'en_cours' || match.paused) return;
    match.chronoSec = (match.chronoSec || 0) + 1;
    Object.values(match.matchPlayers).forEach(mp => { mp.currentStintSec++; });
    pendingMatchSave = true;
    if (!document.getElementById('page-match').classList.contains('hidden')) renderMatch();
  }, 1000);
  autosaveInterval = setInterval(() => {
    const match = currentMatch();
    if (match && pendingMatchSave) { saveMatch(match); pendingMatchSave = false; }
  }, AUTOSAVE_MS);
}
function stopTicking() {
  if (tickInterval) clearInterval(tickInterval);
  if (autosaveInterval) clearInterval(autosaveInterval);
  tickInterval = null;
  autosaveInterval = null;
}

// ---------- Délégation d'événements ----------
document.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const action = btn.dataset.action;
  const id = btn.dataset.id;

  if (action === 'select-team') { state.currentTeamId = id; renderAccueil(); }
  if (action === 'new-team') newTeamModal();
  if (action === 'new-player') newPlayerModal();
  if (action === 'remove-player') {
    if (confirm('Retirer ce joueur ?')) {
      const { error } = await supabase.from('players').delete().eq('id', id);
      if (error) { alert('Erreur : ' + error.message); return; }
      state.players = state.players.filter(p => p.id !== id);
      renderAccueil();
    }
  }
  if (action === 'new-match') newMatchModal();
  if (action === 'open-match') { state.currentMatchId = id; showPage('match'); }
  if (action === 'start-match') startMatchModal(currentMatch());
  if (action === 'but-nous') { const m = currentMatch(); m.scoreNous++; await saveMatch(m); renderMatch(); }
  if (action === 'but-eux') { const m = currentMatch(); m.scoreEux++; await saveMatch(m); renderMatch(); }
  if (action === 'toggle-pause') { const m = currentMatch(); m.paused = !m.paused; await saveMatch(m); renderMatch(); }
  if (action === 'end-match') {
    if (confirm('Terminer le match ?')) {
      const m = currentMatch();
      Object.values(m.matchPlayers).forEach(mp => {
        if (mp.onField) mp.totalFieldSec += mp.currentStintSec; else mp.totalBenchSec += mp.currentStintSec;
        mp.currentStintSec = 0;
      });
      m.status = 'termine';
      stopTicking();
      await saveMatch(m);
      renderMatch();
    }
  }
  if (action === 'export-match') exportMatch(id);
  if (action === 'add-materiel') {
    const team = currentTeam();
    team.materiel.push({ id: uid(), label: 'Nouvel élément', responsable: '', done: false });
    await saveTeamMateriel(team);
    renderMateriel();
  }
  if (action === 'remove-materiel') {
    const team = currentTeam();
    team.materiel = team.materiel.filter(m => m.id !== id);
    await saveTeamMateriel(team);
    renderMateriel();
  }
  if (action === 'add-task') {
    const { data, error } = await supabase.from('tasks').insert({ team_id: state.currentTeamId, label: 'Nouvelle tâche', responsable: '', done: false }).select().single();
    if (error) { alert('Erreur : ' + error.message); return; }
    state.tasks.push({ id: data.id, teamId: data.team_id, label: data.label, responsable: data.responsable, done: data.done });
    renderTaches();
  }
  if (action === 'remove-task') {
    const { error } = await supabase.from('tasks').delete().eq('id', id);
    if (error) { alert('Erreur : ' + error.message); return; }
    state.tasks = state.tasks.filter(t => t.id !== id);
    renderTaches();
  }
  if (action === 'toggle-task') {
    const t = state.tasks.find(t => t.id === id);
    t.done = !t.done;
    await supabase.from('tasks').update({ done: t.done }).eq('id', id);
    renderTaches();
  }
});

document.addEventListener('change', async (e) => {
  const t = e.target;
  const match = currentMatch();

  if (t.dataset.field && match) {
    match[t.dataset.field] = t.value;
    await saveMatch(match);
  }
  if (t.dataset.playerRemark && match) {
    match.playerRemarks[t.dataset.playerRemark] = t.value;
    await saveMatch(match);
  }
  if (t.dataset.materielLabel) { await updateMateriel(t.dataset.materielLabel, 'label', t.value); }
  if (t.dataset.materielResp) { await updateMateriel(t.dataset.materielResp, 'responsable', t.value); }
  if (t.dataset.materielDone) { await updateMateriel(t.dataset.materielDone, 'done', t.checked); }
  if (t.dataset.taskLabel) { await updateTask(t.dataset.taskLabel, 'label', t.value); }
  if (t.dataset.taskResp) { await updateTask(t.dataset.taskResp, 'responsable', t.value); }
});

async function updateMateriel(id, field, value) {
  const team = currentTeam();
  const item = team.materiel.find(m => m.id === id);
  if (item) { item[field] = value; await saveTeamMateriel(team); }
}
async function updateTask(id, field, value) {
  const t = state.tasks.find(t => t.id === id);
  if (t) { t[field] = value; await supabase.from('tasks').update({ [field]: value }).eq('id', id); }
}

document.querySelectorAll('.bottom-nav button[data-page]').forEach(btn => {
  btn.addEventListener('click', () => showPage(btn.dataset.page));
});

// ---------- Démarrage ----------
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
}

initAuth();
