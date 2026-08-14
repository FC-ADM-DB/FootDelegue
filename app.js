// FootDelegue — logique applicative (état 100% local pour l'instant, Supabase à brancher plus tard)

const STORAGE_KEY = 'footdelegue_state_v1';
const FORMATS = { '5v5': 5, '8v8': 8 };
const MATERIEL_DEFAUT = ['Vareuses', 'Gourdes', 'Collation / sandwichs'];

let state = loadState();
let selectedPlayerId = null; // pour la substitution par sélection + clic
let tickInterval = null;

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) { /* état corrompu -> on repart propre */ }
  return { teams: [], players: [], matches: [], tasks: [], currentTeamId: null, currentMatchId: null };
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

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

// ---------- Navigation ----------
const pages = ['accueil', 'match', 'materiel', 'taches', 'historique'];

function showPage(name) {
  pages.forEach(p => {
    document.getElementById('page-' + p).classList.toggle('hidden', p !== name);
  });
  document.querySelectorAll('.bottom-nav button').forEach(b => {
    b.classList.toggle('active', b.dataset.page === name);
  });
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
function renderAccueil() {
  const el = document.getElementById('page-accueil');
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
    const matches = state.matches.filter(m => m.teamId === team.id).sort((a, b) => (a.date || '').localeCompare(b.date || ''));
    if (matches.length === 0) {
      html += '<p class="empty-state">Aucun match programmé.</p>';
    } else {
      matches.filter(m => m.status !== 'termine').forEach(m => {
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
  saveState();
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
  if (!team.materiel) team.materiel = MATERIEL_DEFAUT.map(label => ({ id: uid(), label, responsable: '', done: false }));

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
  `, (overlay) => {
    const name = overlay.querySelector('#m-team-name').value.trim();
    if (!name) return;
    const format = overlay.querySelector('#m-team-format').value;
    const team = { id: uid(), name, format, materiel: MATERIEL_DEFAUT.map(label => ({ id: uid(), label, responsable: '', done: false })) };
    state.teams.push(team);
    state.currentTeamId = team.id;
    saveState();
    showPage('accueil');
  });
}

function newPlayerModal() {
  openModal('Nouveau joueur', `
    <label>Nom du joueur</label>
    <input type="text" id="m-player-name" placeholder="Prénom Nom">
  `, (overlay) => {
    const name = overlay.querySelector('#m-player-name').value.trim();
    if (!name) return;
    state.players.push({ id: uid(), teamId: state.currentTeamId, name });
    saveState();
    showPage('accueil');
  });
}

function newMatchModal() {
  openModal('Nouveau match', `
    <label>Adversaire</label>
    <input type="text" id="m-match-opp" placeholder="Nom de l'équipe adverse">
    <label>Date</label>
    <input type="date" id="m-match-date">
  `, (overlay) => {
    const opponent = overlay.querySelector('#m-match-opp').value.trim();
    const date = overlay.querySelector('#m-match-date').value;
    const match = {
      id: uid(), teamId: state.currentTeamId, opponent, date,
      heureRdv: '', heureMatch: '', lieu: '', maillot: '', meteo: '', contact: '',
      status: 'prevu', scoreNous: 0, scoreEux: 0, chronoSec: 0, paused: false,
      events: [], remarkGeneral: '', playerRemarks: {}, matchPlayers: {}
    };
    state.matches.push(match);
    state.currentMatchId = match.id;
    saveState();
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
  openModal('Composition de départ', fieldsHtml, (overlay) => {
    const checked = [...overlay.querySelectorAll('[data-lineup]:checked')].map(i => i.dataset.lineup);
    players.forEach(p => {
      match.matchPlayers[p.id] = {
        onField: checked.includes(p.id),
        currentStintSec: 0, totalFieldSec: 0, totalBenchSec: 0
      };
    });
    match.status = 'en_cours';
    saveState();
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
    saveState();
    if (!document.getElementById('page-match').classList.contains('hidden')) renderMatch();
  }, 1000);
}
function stopTicking() {
  if (tickInterval) clearInterval(tickInterval);
  tickInterval = null;
}

// ---------- Délégation d'événements ----------
document.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const action = btn.dataset.action;
  const id = btn.dataset.id;

  if (action === 'select-team') { state.currentTeamId = id; saveState(); renderAccueil(); }
  if (action === 'new-team') newTeamModal();
  if (action === 'new-player') newPlayerModal();
  if (action === 'remove-player') {
    if (confirm('Retirer ce joueur ?')) { state.players = state.players.filter(p => p.id !== id); saveState(); renderAccueil(); }
  }
  if (action === 'new-match') newMatchModal();
  if (action === 'open-match') { state.currentMatchId = id; saveState(); showPage('match'); }
  if (action === 'start-match') startMatchModal(currentMatch());
  if (action === 'but-nous') { currentMatch().scoreNous++; saveState(); renderMatch(); }
  if (action === 'but-eux') { currentMatch().scoreEux++; saveState(); renderMatch(); }
  if (action === 'toggle-pause') { currentMatch().paused = !currentMatch().paused; saveState(); renderMatch(); }
  if (action === 'end-match') {
    if (confirm('Terminer le match ?')) {
      const m = currentMatch();
      Object.values(m.matchPlayers).forEach(mp => {
        if (mp.onField) mp.totalFieldSec += mp.currentStintSec; else mp.totalBenchSec += mp.currentStintSec;
        mp.currentStintSec = 0;
      });
      m.status = 'termine';
      stopTicking();
      saveState();
      renderMatch();
    }
  }
  if (action === 'export-match') exportMatch(id);
  if (action === 'add-materiel') {
    currentTeam().materiel.push({ id: uid(), label: 'Nouvel élément', responsable: '', done: false });
    saveState(); renderMateriel();
  }
  if (action === 'remove-materiel') {
    const team = currentTeam();
    team.materiel = team.materiel.filter(m => m.id !== id);
    saveState(); renderMateriel();
  }
  if (action === 'add-task') {
    state.tasks.push({ id: uid(), teamId: state.currentTeamId, label: 'Nouvelle tâche', responsable: '', done: false });
    saveState(); renderTaches();
  }
  if (action === 'remove-task') { state.tasks = state.tasks.filter(t => t.id !== id); saveState(); renderTaches(); }
  if (action === 'toggle-task') {
    const t = state.tasks.find(t => t.id === id);
    t.done = !t.done; saveState(); renderTaches();
  }
});

document.addEventListener('change', (e) => {
  const t = e.target;
  const match = currentMatch();

  if (t.dataset.field && match) {
    match[t.dataset.field] = t.value;
    saveState();
  }
  if (t.dataset.playerRemark && match) {
    match.playerRemarks[t.dataset.playerRemark] = t.value;
    saveState();
  }
  if (t.dataset.materielLabel) { updateMateriel(t.dataset.materielLabel, 'label', t.value); }
  if (t.dataset.materielResp) { updateMateriel(t.dataset.materielResp, 'responsable', t.value); }
  if (t.dataset.materielDone) { updateMateriel(t.dataset.materielDone, 'done', t.checked); }
  if (t.dataset.taskLabel) { updateTask(t.dataset.taskLabel, 'label', t.value); }
  if (t.dataset.taskResp) { updateTask(t.dataset.taskResp, 'responsable', t.value); }
});

function updateMateriel(id, field, value) {
  const item = currentTeam().materiel.find(m => m.id === id);
  if (item) { item[field] = value; saveState(); }
}
function updateTask(id, field, value) {
  const t = state.tasks.find(t => t.id === id);
  if (t) { t[field] = value; saveState(); }
}

document.querySelectorAll('.bottom-nav button[data-page]').forEach(btn => {
  btn.addEventListener('click', () => showPage(btn.dataset.page));
});

// ---------- Démarrage ----------
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
}

if (currentMatch()?.status === 'en_cours') startTicking();
showPage('accueil');
