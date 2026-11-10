// The first ten chapters of Claude's campaign, with the original First Light prologue.
// Uses the campaign's real assets and history;
// all profile/save writes are namespaced by App, never by changing campaign progress.
import { icon } from './icons.js';
import { BriefingScreen } from './screens.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const FOREST = 'assets/painted/m01/dawn/tile_11.jpg';

const NUMBER = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
const MONTHS = ['JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE', 'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER'];
const monthYear = (d) => { const [y, m] = String(d).split('-'); return `${MONTHS[+m - 1]} ${y}`; };

export class DemoScreen {
  constructor(app, { phase = 'welcome', id = 'm01' } = {}) {
    this.app = app; this.id = app.byId.has(id) ? id : 'm01'; this.meta = app.byId.get(this.id);
    this.phase = phase; this.index = 0; this.auto = true; this.version = 0;
  }
  async enter(root) {
    this.root = root;
    this.content = await this.app.content(this.id);
    if (this.dead) return;
    this.history = this.content?.documentary || [];
    this.endIndex = this.history.length + (this.id === 'm01' ? 2 : 0);
    this.backdrop = this.id === 'm01' ? FOREST : `assets/photos/${this.history.find(s => s.photo)?.photo || 'm01_5.jpg'}`;
    root.addEventListener('pointerdown', (event) => { this.enableSoundOnly = !this.app.audio.ready && !!event.target.closest('[data-demo="sound"]'); });
    root.addEventListener('click', (event) => {
      const button = event.target.closest('[data-demo]');
      if (!button) return;
      this.app.unlockAudio();
      this.action(button.dataset.demo);
    });
    this.onKey = (e) => {
      if (this.root.querySelector('dialog[open]')) return;
      if (this.phase !== 'story' || /INPUT|SELECT|TEXTAREA/.test(e.target.tagName)) return;
      if (e.key === 'ArrowRight') { e.preventDefault(); this.go(this.index + 1); }
      if (e.key === 'ArrowLeft') { e.preventDefault(); this.go(this.index - 1); }
      if (e.code === 'Space' && e.target === document.body && this.index < this.endIndex) { e.preventDefault(); this.action('pause'); }
    };
    this.onHidden = () => {
      if (document.hidden && this.phase === 'story' && this.index < this.endIndex && this.auto) this.action('pause');
    };
    window.addEventListener('keydown', this.onKey);
    document.addEventListener('visibilitychange', this.onHidden);
    // The next photographs are small enough to warm while the opening theme plays.
    for (const slide of this.history) if (slide.photo) { const img = new Image(); img.src = `assets/photos/${slide.photo}`; }
    this.render();
  }
  header(section) {
    return `<header class="demo-header"><button class="demo-brand" data-demo="home" aria-label="Demo opening">N<span> / </span>NIGHTJARS</button><span class="demo-section">${section}</span><button class="demo-sound" data-demo="sound" aria-label="Toggle sound">${icon('speaker')}<span>${this.soundLabel()}</span></button></header>`;
  }
  soundLabel() { return !this.app.audio.ready ? 'Enable sound' : this.app.settings.master > 0 ? 'Sound on' : 'Sound off'; }
  frame(body, section, photo = FOREST, className = '') {
    this.root.innerHTML = `<div class="demo-shell ${className}"><img class="demo-backdrop" src="${esc(photo)}" alt=""><div class="demo-shade"></div><div class="demo-haze" aria-hidden="true"></div>${this.header(section)}${body}</div>`;
  }
  render() {
    this.cancelAdvance();
    if (this.phase === 'chapters') this.chapters();
    else if (this.phase === 'welcome') this.welcome();
    else if (this.phase === 'end') this.end();
    else if (this.index === this.endIndex) this.briefing();
    else this.story();
    this.updateScore();
  }
  updateScore() {
    const historical = this.phase === 'story' && this.index < this.endIndex;
    const track = historical && this.app.tracks.find(t => t.kind !== 'score' && (t.suggestedFor || []).includes(this.id));
    if (track && this.app.audio.ready) {
      if (this.docTrack !== track.file) {
        this.app.mood('silence', this.meta.theatre);
        this.app.music.playTrack(`assets/music/${track.file}`, { volume: .55 });
        this.docTrack = track.file;
      }
      return;
    }
    if (this.docTrack) { this.app.music.stopTrack(1.5); this.docTrack = null; }
    this.app.mood(this.phase === 'end' ? 'letter' : ['welcome', 'chapters'].includes(this.phase) ? 'title' : this.index === this.endIndex ? 'tension' : 'documentary', this.meta.theatre);
  }
  count() { return this.app.missions.length; }
  countWord(cap = false) { const n = this.count(), w = NUMBER[n] || String(n); return cap ? w[0].toUpperCase() + w.slice(1) : w; }
  total() { return this.app.campaign.missions.filter((m) => m.type !== 'epilogue').length; }
  span() { const ms = this.app.missions; return `${monthYear(ms[0].date)} — ${monthYear(ms[ms.length - 1].date)}`; }
  // The public demo lists what is still to come after its last chapter.
  comingSoon() {
    if (!this.app.release.public) return '';
    const n = this.count(), rest = this.total() - n, nxt = this.app.campaign.missions[n];
    return `<div class="demo-coming-soon" aria-label="Coming soon"><span>${String(n + 1).padStart(2, '0')}—${this.total()} / ${esc(this.app.formatDate(nxt.date))} → 2 SEPTEMBER 1945</span><b>Coming soon</b><small>${rest} more operations, to the last day of the war</small><em>Next: ${esc(nxt.title)}</em></div>`;
  }
  welcome() {
    const saved = this.app.latestSave(), progressed = this.app.profile.reached > 0;
    this.frame(`<main class="demo-welcome">
      <div class="demo-eyebrow"><i></i> A PLAYABLE DOCUMENTARY · ${this.countWord().toUpperCase()} CHAPTERS${this.app.release.public ? ' · DEMO' : ''}</div>
      <h1>NIGHTJARS</h1><div class="demo-years">2,194 DAYS <span>1939 — 1945</span></div>
      <p class="demo-tagline">The history is real.<br>Now find your place inside it.</p>
      <div class="demo-start"><button class="demo-primary" data-demo="continue">${progressed ? 'Continue the story' : 'Begin the story'} <span>→</span></button>${saved ? `<button class="demo-text-button" data-demo="resume">Resume ${esc(this.app.byId.get(saved.mission).title)}</button>` : ''}<button class="demo-text-button" data-demo="chapters">Choose a chapter</button></div>
      <p class="demo-listen">Headphones recommended <span>·</span> Landscape on iPad</p>
    </main>
    <aside class="demo-issue"><span>THE OPENING QUESTION</span><b>First Light</b><p>${esc(this.content.learning?.question || 'Poland. A forest at dawn.')}</p><span>23 AUGUST — 01 SEPTEMBER 1939</span></aside>
    <footer class="demo-footer"><span>${this.app.release.public ? 'DEMO · ' : ''}${this.countWord().toUpperCase()} PLAYABLE MISSIONS <i> / </i> ${this.span()}</span><nav><button data-demo="settings">Settings</button><button data-demo="credits">Credits &amp; sources</button></nav></footer>`, 'THE FIRST YEAR');
  }
  chapters() {
    this.frame(`<main class="demo-chapters"><div class="demo-eyebrow">${this.app.release.public ? 'DEMO' : 'THE FIRST YEAR'} / OPERATIONS 01—${String(this.count()).padStart(2, '0')}</div><h1>${this.countWord(true)} chapters. One continuing story.</h1><p>Follow the campaign in order, or preview any chapter. Choosing a chapter does not mark it completed.</p><div class="demo-chapter-grid">${this.app.missions.map((m, i) => `<button data-demo="chapter:${m.id}"><span>${String(i + 1).padStart(2, '0')} / ${esc(this.app.formatDate(m.date))}</span><b>${esc(m.title)}</b><small>${esc(m.country)} · ${esc(m.type)}</small><em>${this.app.profile.completed[m.id] ? 'Completed · revisit' : 'Documentary → briefing → mission'}</em></button>`).join('')}${this.comingSoon()}</div></main><footer class="demo-footer"><button data-demo="home">← Opening</button><span>Progress and saves stay separate from the full campaign</span></footer>`, 'CHAPTER SELECT');
  }
  story() {
    let body, text, photo = this.backdrop, className = 'demo-story';
    const historical = this.index < this.history.length;
    if (this.index === this.history.length) {
      text = 'I promised you I would come home. I keep my word, Mama, even when I am slow about it.';
      body = `<main class="demo-promise"><span class="demo-eyebrow">A LETTER THAT WILL BE WRITTEN TONIGHT</span><blockquote>“I promised you<br>I would come home.”</blockquote><p>I keep my word, Mama,<br>even when I am slow about it.</p><div class="demo-signature">Tomasz</div><span class="demo-fiction">From Wrona’s first letter · historical fiction</span></main>`;
    } else if (historical) {
      const s = this.history[this.index];
      photo = s.photo ? `assets/photos/${s.photo}` : this.backdrop;
      text = [s.narration, s.why].filter(Boolean).join(' ');
      className += ' demo-history';
      body = `<main class="demo-history-copy"><div class="demo-eyebrow">${esc(this.app.formatDate(s.date))}</div><h1>${esc(s.heading)}</h1><p>${esc(s.narration)}</p>${s.why ? `<div class="demo-context"><span>WHY IT MATTERS</span><p>${esc(s.why)}</p></div>` : ''}</main>
      <aside class="demo-photo-credit"><b class="demo-photo-type">${s.kind === 'file' ? 'Fictional story document · not archival evidence' : esc(s.imageType || 'Archive image · see caption for image date')}</b><p>${esc(s.caption || '')}</p><span>${esc(s.credit || '')}${s.license ? ' · ' + esc(s.license) : ''}</span>${s.photo ? '<button class="demo-inspect" data-demo="inspect">Explore photograph &amp; sources ↗</button>' : ''}</aside>`;
    } else {
      text = 'Lieutenant Tomasz Wrona. The Germans are between you and the Polish lines. Somewhere in the forest lies a courier’s car. Recover his dispatch satchel. Keep its seal intact. Get back alive.';
      className += ' demo-character';
      body = `<img class="demo-portrait" src="assets/portraits/wrona.jpg" alt="Portrait of the fictional Lieutenant Tomasz Wrona">
      <main class="demo-character-copy"><div class="demo-eyebrow">FROM THE HISTORICAL RECORD TO THE MISSION</div><h1>One man.<br>One promise.</h1><h2>Lieutenant Tomasz Wrona</h2><p>A Polish cavalry officer, on foot behind the advancing German lines. A missing courier. A sealed dispatch. A way home through the pines.</p><p class="demo-fiction">Wrona and this mission are fictional.<br>The photographs show real people, not our invented squad.</p></main>`;
    }
    const label = historical && this.history[this.index].kind !== 'file' ? `THE HISTORICAL RECORD · ${String(this.index + 1).padStart(2, '0')} / ${String(this.history.length).padStart(2, '0')}` : 'HISTORICAL FICTION';
    this.frame(body + this.transport(), label, photo, className);
    this.currentText = text;
    this.schedule();
  }
  inspectPhotograph() {
    const original = this.history[this.index];
    const slide = original && { ...original, imageType: original.imageType || 'Archive image · image date is in the caption', imageNote: original.imageNote || original.caption, why: original.why || 'This image illustrates the historical chapter. Its capture date may differ from the event date; the caption and archive record identify what it actually shows.' };
    if (!slide?.photo || this.root.querySelector('dialog[open]')) return;
    // Reading evidence never races the automatic story. Closing leaves it paused.
    if (this.auto) this.action('pause');
    const dialog = document.createElement('dialog');
    dialog.className = 'demo-archive-dialog';
    dialog.setAttribute('aria-labelledby', 'demo-archive-title');
    dialog.innerHTML = `<header><div><span class="demo-eyebrow">THE PHOTOGRAPH AS EVIDENCE</span><h2 id="demo-archive-title">${esc(slide.heading)}</h2></div><button data-demo="close-photo" autofocus aria-label="Close photograph">Close ×</button></header>
      <div class="demo-archive-body"><figure><img src="assets/photos/${esc(slide.photo)}" alt="${esc(slide.caption)}"><figcaption>Full image · no cinematic crop or colour filter in this view</figcaption></figure>
      <section class="demo-archive-notes"><b class="demo-photo-type">${esc(slide.imageType || 'Archive photograph')}</b><p>${esc(slide.caption)}</p><h3>Read the image carefully</h3><p>${esc(slide.imageNote || '')}</p><h3>Why it matters</h3><p>${esc(slide.why || '')}</p><a href="${esc(slide.historySource || slide.source)}" target="_blank" rel="noopener noreferrer">${esc(slide.historySourceLabel || 'Historical source')} ↗</a><h3>Credit &amp; provenance</h3><p class="demo-archive-credit">${esc(slide.credit)}<br>${slide.licenseUrl ? `<a href="${esc(slide.licenseUrl)}" target="_blank" rel="noopener noreferrer">${esc(slide.license)}</a>` : esc(slide.license)}</p><a href="${esc(slide.source)}" target="_blank" rel="noopener noreferrer">Open the archive record ↗</a><p class="demo-archive-small">The local image is resized and JPEG-encoded for the game. The cinematic view uses framing and tonal filters. No generated image is presented as a historical photograph.</p></section></div>
      <footer>The story is paused. Close this view, then choose Continue story when you are ready.</footer>`;
    dialog.addEventListener('close', () => { dialog.remove(); this.root.querySelector('[data-demo="inspect"]')?.focus(); }, { once: true });
    this.root.appendChild(dialog);
    dialog.showModal();
  }
  transport() {
    return `<footer class="demo-transport"><div class="demo-timeline" aria-label="Story progress">${Array.from({ length: this.endIndex }, (_, i) => `<span class="${i < this.index ? 'past' : i === this.index ? 'current' : ''}"><i></i></span>`).join('')}</div><div class="demo-transport-row"><button data-demo="prev" aria-label="Previous scene" ${this.index ? '' : 'disabled'}>← Back</button><button data-demo="pause">${this.auto ? 'Ⅱ Pause story' : '▷ Continue story'}</button><button data-demo="voice" aria-pressed="${!!this.app.settings.narration}">Narration ${this.app.settings.narration ? 'on' : 'off'}</button><button class="demo-skip" data-demo="briefing">To briefing</button><button class="demo-next" data-demo="next">${this.index === this.endIndex - 1 ? 'Your orders' : 'Next'} →</button></div></footer>`;
  }
  briefing() {
    if (this.id !== 'm01') return this.chapterBriefing();
    this.frame(`<main class="demo-briefing"><section class="demo-orders"><div class="demo-eyebrow">FIELD ORDERS / 001</div><h1>First Light</h1><p class="demo-location">Tuchola Forest, Poland · Dawn · 1 September 1939</p>
      <blockquote>“You go alone and on foot. A horse makes noise, and a squadron makes a battle.”<cite>Rotmistrz Jan Zaremba</cite></blockquote>
      <ol class="demo-objectives"><li><span>01</span><div><b>Find the courier</b><p>Locate the wrecked staff car in the forest.</p></div></li><li><span>02</span><div><b>Recover the satchel</b><p>Take the sealed dispatch. Watch the sentries.</p></div></li><li><span>03</span><div><b>Reach the Polish lines</b><p>Cross by bridge or ford—not deep water.</p></div></li></ol>
      <details class="demo-full-orders"><summary>Read the full briefing</summary><p>${esc(this.content?.briefing?.text || '')}</p></details>
      <details class="demo-full-orders demo-history-bridge"><summary>How this mission fits the history</summary><p>${esc(this.content.learning?.connection)}</p><p>${esc(this.content.learning?.boundary)}</p></details>
      <div class="demo-launch"><button class="demo-primary" data-demo="deploy">Enter the forest <span>→</span></button><span>Go quietly, Lieutenant.</span></div>
    </section><aside class="demo-field-file"><div class="demo-file-label">RECONNAISSANCE / TUCHOLA</div><div class="recon"><canvas></canvas><span>Recon sketch</span></div><div class="demo-officer"><img src="assets/portraits/wrona.jpg" alt="Tomasz Wrona"><div><b>Tomasz Wrona</b><span>Infiltrator · Poland</span></div></div><label class="demo-difficulty">Difficulty<select aria-label="Demo difficulty">${[['easy','Recruit · recommended'],['normal','Veteran'],['hard','Nightjar']].map(([v,l])=>`<option value="${v}" ${this.app.profile.difficulty===v?'selected':''}>${l}</option>`).join('')}</select></label><p class="demo-file-tip">Observe. Crawl. Distract.<br>You can pause and give orders at any time.</p></aside></main>
    <footer class="demo-footer"><button class="demo-text-button" data-demo="prev">← Back to the story</button><span>YOUR CAMPAIGN SAVES ARE UNTOUCHED</span></footer>`, 'YOUR MISSION', FOREST, 'demo-brief');
    this.root.querySelector('select').addEventListener('change', (e) => { this.app.profile.difficulty = e.target.value; this.app.saveProfile(); });
    this.app.missionDef('m01').then((def) => {
      if (!this.dead && this.index === this.endIndex && this.root.querySelector('.recon canvas')) new BriefingScreen(this.app, { id: 'm01' }).drawRecon(this.root.querySelector('.recon canvas'), def);
    });
  }
  end() {
    if (this.id !== 'm01') return this.chapterEnd();
    const lessons = (this.content.learning?.takeaways || []).map((t,i) => `<article><span>0${i+1}</span><div><h3>${esc(t.heading)}</h3><p>${esc(t.text)}</p><a href="${esc(t.source)}" target="_blank" rel="noopener noreferrer">${esc(t.sourceLabel)} ↗</a></div></article>`).join('');
    this.frame(`<main class="demo-ending"><section class="demo-ending-copy"><div class="demo-eyebrow">END OF CHAPTER ONE</div><h1>One morning.<br>A war still to come.</h1><p>You got one man through.<br>Poland's struggle is far from over.</p><div class="demo-start"><button class="demo-primary" data-demo="onward">Next: The Kuty Bridge <span>→</span></button><button class="demo-text-button" data-demo="replay">Play the mission again</button><button class="demo-text-button" data-demo="begin">Revisit the documentary</button></div></section><aside class="demo-takeaways"><div class="demo-eyebrow">BEYOND YOUR MISSION</div>${lessons}<p class="demo-fiction">Wrona's escape and letter are fiction.<br>The historical outcomes above are not.</p></aside></main><footer class="demo-footer"><button data-demo="chapters">All ${this.countWord()} chapters</button><button class="demo-text-button" data-demo="credits">Music, photographs &amp; sources</button></footer>`, 'FIRST LIGHT / COMPLETE', FOREST, 'demo-complete');
  }
  chapterBriefing() {
    const m = this.meta, c = this.content;
    this.frame(`<main class="demo-briefing"><section class="demo-orders"><div class="demo-eyebrow">FIELD ORDERS / ${String(m.index + 1).padStart(3, '0')}</div><h1>${esc(m.title)}</h1><p class="demo-location">${esc(m.place)} · ${esc(this.app.formatDate(m.date))} · ${esc(m.time)} / ${esc(m.weather)}</p><div class="demo-brief-text"><span class="demo-eyebrow">${esc(c.briefing.from)}</span><p>${esc(c.briefing.text)}</p></div><ol class="demo-objectives">${m.objectives.map((o,i) => `<li><span>${String(i+1).padStart(2,'0')}</span><div><b>${esc(o)}</b></div></li>`).join('')}</ol><p class="demo-fiction">Historical fiction within real events. The squad, dialogue and tactical map are dramatized, not a surveyed reconstruction.</p><div class="demo-launch"><button class="demo-primary" data-demo="deploy">Begin mission <span>→</span></button></div></section><aside class="demo-field-file"><div class="demo-file-label">RECONNAISSANCE / ${esc(m.country)}</div><div class="recon"><canvas></canvas><span>Recon sketch</span></div>${m.heroes.map(id => `<div class="demo-officer"><img src="assets/portraits/${esc(id)}.jpg" alt="Portrait of fictional ${esc(this.app.heroName(id))}"><div><b>${esc(this.app.heroName(id))}</b><span>${esc(this.app.heroData[id]?.role)}</span></div></div>`).join('')}<label class="demo-difficulty">Difficulty<select aria-label="Demo difficulty">${[['easy','Recruit · recommended'],['normal','Veteran'],['hard','Nightjar']].map(([v,l])=>`<option value="${v}" ${this.app.profile.difficulty===v?'selected':''}>${l}</option>`).join('')}</select></label><p class="demo-file-tip">Observe. Plan. Move.<br>Pause at any time to give orders.</p></aside></main><footer class="demo-footer"><button data-demo="prev">← Back to the story</button><button data-demo="chapters">All ${this.countWord()} chapters</button></footer>`, `CHAPTER ${m.index + 1} / ${this.count()}`, this.backdrop, 'demo-brief');
    this.root.querySelector('select').addEventListener('change', e => { this.app.profile.difficulty = e.target.value; this.app.saveProfile(); });
    this.app.missionDef(this.id).then(def => { const cv = this.root.querySelector('.recon canvas'); if (!this.dead && cv && def) new BriefingScreen(this.app, {id:this.id}).drawRecon(cv, def); });
  }
  chapterEnd() {
    const next = this.app.nextMission(this.id), c = this.content;
    this.frame(`<main class="demo-ending"><section class="demo-ending-copy"><div class="demo-eyebrow">CHAPTER ${this.meta.index + 1} / ${this.count()} COMPLETE</div><h1>${next ? 'The story continues.' : this.app.release.public ? 'End of the demo.<br>The war goes on.' : 'The first year.<br>The fight goes on.'}</h1><p>${esc(this.meta.title)}</p><div class="demo-start">${next ? `<button class="demo-primary" data-demo="onward">Next: ${esc(next.title)} <span>→</span></button>` : `<button class="demo-primary" data-demo="chapters">Explore the ${this.countWord()} chapters <span>→</span></button>`}<button class="demo-text-button" data-demo="replay">Replay mission</button><button class="demo-text-button" data-demo="begin">Revisit documentary</button></div><p class="demo-fiction">${!next && this.app.release.public ? `The full campaign, ${this.total()} operations from September 1939 to September 1945, is coming soon. Your progress is saved.` : `The historical record continues beyond this ${this.countWord()}-mission ${this.app.release.public ? 'demo' : 'playtest'}. Your progress is saved.`}</p></section><aside class="demo-takeaways"><div class="demo-eyebrow">FROM THE HISTORICAL RECORD</div>${(c.facts || []).slice(0,3).map((f,i)=>`<article><span>0${i+1}</span><p>${esc(f)}</p></article>`).join('')}<details><summary>Chapter sources</summary>${(c.sources || []).map((s,i)=>`<a href="${esc(s)}" target="_blank" rel="noopener noreferrer">Source ${i+1} · ${esc(new URL(s).hostname)} ↗</a><br>`).join('')}</details></aside></main><footer class="demo-footer"><button data-demo="chapters">All ${this.countWord()} chapters</button><button data-demo="credits">Music, photographs &amp; sources</button></footer>`, `${esc(this.meta.title)} / COMPLETE`, this.backdrop, 'demo-complete');
  }
  cancelAdvance() { clearTimeout(this.timer); this.version++; this.app.narrator.stop(); }
  schedule() {
    this.cancelAdvance();
    if (!this.auto || this.phase !== 'story' || this.index === this.endIndex) return;
    const token = this.version;
    const duration = Math.max(13000, this.currentText.split(/\s+/).length * 350 + 4000);
    const bar = this.root.querySelector('.demo-timeline .current i');
    if (bar) { bar.style.animation = 'none'; void bar.offsetWidth; bar.style.animation = `demo-progress ${duration}ms linear forwards`; }
    const advance = () => { if (!this.dead && token === this.version) this.go(this.index + 1); };
    if (this.app.settings.narration && this.app.audio.ready && this.app.settings.master > 0) {
      this.app.narrator.speak(this.currentText, () => { if (!this.dead && token === this.version) this.timer = setTimeout(advance, 1800); });
    } else this.timer = setTimeout(advance, duration);
  }
  go(index) { this.phase = 'story'; this.index = Math.max(0, Math.min(this.endIndex, index)); this.render(); }
  action(action) {
    if (action === 'continue') return this.app.continueCampaign();
    if (action === 'chapters') { this.phase = 'chapters'; this.render(); }
    if (action.startsWith('chapter:')) return this.app.beginMission(action.slice(8));
    if (action === 'onward') { const next = this.app.nextMission(this.id); if (next) return this.app.beginMission(next.id); }
    if (action === 'begin') { this.auto = true; this.go(0); }
    if (action === 'home') { this.phase = 'welcome'; this.render(); }
    if (action === 'prev') this.go(this.index - 1);
    if (action === 'next') this.go(this.index + 1);
    if (action === 'inspect') this.inspectPhotograph();
    if (action === 'close-photo') this.root.querySelector('dialog[open]')?.close();
    if (action === 'briefing' || action === 'replay') this.go(this.endIndex);
    if (action === 'pause') {
      this.auto = !this.auto;
      this.root.querySelector('[data-demo="pause"]').textContent = this.auto ? 'Ⅱ Pause story' : '▷ Continue story';
      const bar = this.root.querySelector('.demo-timeline .current i');
      if (bar) bar.style.animationPlayState = this.auto ? 'running' : 'paused';
      this.auto ? this.schedule() : this.cancelAdvance();
    }
    if (action === 'voice') {
      this.app.settings.narration = !this.app.settings.narration; this.app.saveProfile();
      const b = this.root.querySelector('[data-demo="voice"]'); b.textContent = `Narration ${this.app.settings.narration ? 'on' : 'off'}`; b.setAttribute('aria-pressed', this.app.settings.narration);
      this.schedule();
    }
    if (action === 'sound') {
      // The first gesture has already unlocked sound through App's pointer listener.
      this.app.settings.master = this.enableSoundOnly ? 0.9 : this.app.settings.master > 0 ? 0 : 0.9;
      this.enableSoundOnly = false;
      this.app.audio.applyVolumes(); this.app.saveProfile();
      this.root.querySelector('.demo-sound span').textContent = this.soundLabel();
      if (this.phase === 'story' && this.index < this.endIndex) this.schedule();
    }
    if (action === 'settings' || action === 'credits') this.app.show(action);
    if (action === 'deploy') {
      const saved = this.app.latestSave();
      if (saved && !confirm(`Starting this mission replaces the current autosave (${this.app.byId.get(saved.mission).title}). Continue?`)) return;
      const b = this.root.querySelector('[data-demo="deploy"]'); b.disabled = true;
      this.app.playMission(this.id, { difficulty: this.app.profile.difficulty });
    }
    if (action === 'resume') {
      try {
        const saved = this.app.latestSave();
        if (saved) this.app.playMission(saved.mission, { difficulty: saved.difficulty, save: saved });
        else this.go(this.endIndex);
      } catch (e) { this.go(this.endIndex); }
    }
  }
  onAudioReady() {
    this.updateScore();
    const label = this.root?.querySelector('.demo-sound span'); if (label) label.textContent = this.soundLabel();
    if (this.phase === 'story' && this.index < this.endIndex && this.currentText) this.schedule();
  }
  exit() {
    this.dead = true; this.cancelAdvance();
    window.removeEventListener('keydown', this.onKey);
    document.removeEventListener('visibilitychange', this.onHidden);
    this.app.sfx.stopAmbience();
    if (this.docTrack) this.app.music.stopTrack(1.5);
  }
}
