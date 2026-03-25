// ============================================================
//  ENGINE.JS — Motor central do jogo
//  Independente de fase. Recebe um objeto "fase" e roda tudo.
//  Suporta múltiplos insetos por fase (células tipo 3).
// ============================================================

const Engine = (() => {

  // ── Estado ─────────────────────────────────────────────
  let faseAtual  = null;
  let comandos   = [];
  let cursorIndex = 0;     // Indica a posição de inserção atual
  let pos        = { r: 0, c: 0 };
  let direcao    = 0;      // 0=direita 1=baixo 2=esquerda 3=cima
  let executando = false;
  let passos     = 0;
  let faseNum    = 1;

  // Lista de bugs ativos nesta fase
  let bugs = [];   // [{ r, c, emoji, vivo }]

  // Animação de glitch por bug
  let glitchStates = [];
  let bugPhases    = [];

  // Pool de emojis — joaninha, grilo, formiga, lagarta
  const EMOJI_POOL = ['🐞', '🦗', '🐜', '🐛'];
  function _sortearEmoji() {
    return EMOJI_POOL[Math.floor(Math.random() * EMOJI_POOL.length)];
  }

  const DIRS = [
    { dr: 0, dc:  1, angle:  0          },
    { dr: 1, dc:  0, angle:  Math.PI/2  },
    { dr: 0, dc: -1, angle:  Math.PI    },
    { dr:-1, dc:  0, angle: -Math.PI/2  },
  ];

  // ── Tela de renderização ────────────────────────────────
  const cv       = document.getElementById('game-canvas');
  const ctx      = cv.getContext('2d');
  const bugLayer = document.getElementById('bug-layer');

  // Canvas offscreen para pré-renderizar o mapa estático
  // (paredes, grid) — desenhado só quando a fase muda
  let offscreen    = null;
  let offCtx       = null;
  let mapaPreRend  = false;

  let CELL = 36, COLS = 8, ROWS = 8;

  // Coordenadas animadas da nave (efeito de deslizamento e rotação)
  let animPx = 0, animPy = 0, animAngle = 0;

  // Partículas da captura dos bugs: arrays paralelos evitam criação de objetos no loop
  const MAX_PARTICLES = 80;
  let pX   = new Float32Array(MAX_PARTICLES);
  let pY   = new Float32Array(MAX_PARTICLES);
  let pVX  = new Float32Array(MAX_PARTICLES);
  let pVY  = new Float32Array(MAX_PARTICLES);
  let pL   = new Float32Array(MAX_PARTICLES); // life
  let pCol = new Uint8Array(MAX_PARTICLES);   // 0=azul 1=ambar
  let pCount = 0;

  let rafId = null;

  // ── Ajuste do tamanho do canvas ─────────────────────────
  function _setCanvasSize(rows, cols) {
    ROWS = rows; COLS = cols;
    const mobile = window.innerWidth <= 700;
    const maxPx = mobile
      ? Math.floor(Math.min(window.innerWidth * 0.92, window.innerHeight * 0.45))
      : 380;
    CELL = Math.floor(maxPx / Math.max(rows, cols));
    cv.width  = CELL * cols;
    cv.height = CELL * rows;
    bugLayer.style.width  = cv.width  + 'px';
    bugLayer.style.height = cv.height + 'px';

    offscreen = document.createElement('canvas');
    offscreen.width  = cv.width;
    offscreen.height = cv.height;
    offCtx = offscreen.getContext('2d');
    mapaPreRend = false;
  }

  // Recalcula o canvas quando a janela é redimensionada
  let _resizeTimer = null;
  window.addEventListener('resize', () => {
    clearTimeout(_resizeTimer);
    _resizeTimer = setTimeout(() => {
      if (faseAtual) {
        _setCanvasSize(faseAtual.mapa.length, faseAtual.mapa[0].length);
        animPx = pos.c * CELL + CELL / 2;
        animPy = pos.r * CELL + CELL / 2;
        bugEls.forEach((el, i) => {
          if (!bugs[i].vivo) return;
          el.style.left     = (bugs[i].c * CELL) + 'px';
          el.style.top      = (bugs[i].r * CELL) + 'px';
          el.style.width    = CELL + 'px';
          el.style.height   = CELL + 'px';
          el.style.fontSize = Math.floor(CELL * 0.52) + 'px';
        });
      }
    }, 150);
  });

  // Pré-renderiza o mapa (fundo + grid + paredes) no canvas offscreen
  // Chamado apenas uma vez por fase, não a cada frame
  function _preRenderizarMapa() {
    const W = offscreen.width, H = offscreen.height;
    // Apaga tudo no offscreen
    offCtx.clearRect(0, 0, W, H);

    // Fundo escuro
    offCtx.fillStyle = '#040e1a';
    offCtx.fillRect(0, 0, W, H);

    // Micro-grid de fundo — desenhado em um único path por direção
    offCtx.strokeStyle = 'rgba(93,173,226,.04)'; offCtx.lineWidth = .5;
    offCtx.beginPath();
    for (let i = 0; i <= W; i += 10) { offCtx.moveTo(i, 0); offCtx.lineTo(i, H); }
    for (let i = 0; i <= H; i += 10) { offCtx.moveTo(0, i); offCtx.lineTo(W, i); }
    offCtx.stroke();

    // Grade de células — também em path único
    offCtx.strokeStyle = 'rgba(93,173,226,.12)'; offCtx.lineWidth = .5;
    offCtx.beginPath();
    for (let i = 0; i <= COLS; i++) { offCtx.moveTo(i*CELL, 0); offCtx.lineTo(i*CELL, H); }
    for (let i = 0; i <= ROWS; i++) { offCtx.moveTo(0, i*CELL); offCtx.lineTo(W, i*CELL); }
    offCtx.stroke();

    // Paredes — fill + borda + hachuras
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (faseAtual.mapa[r][c] !== 0) continue;
        const x = c * CELL, y = r * CELL;
        offCtx.fillStyle = 'rgba(93,173,226,.10)';
        offCtx.fillRect(x+.5, y+.5, CELL-1, CELL-1);
        offCtx.strokeStyle = 'rgba(93,173,226,.30)'; offCtx.lineWidth = .8;
        offCtx.strokeRect(x+.5, y+.5, CELL-1, CELL-1);
        // Hachura diagonal em path único por célula
        offCtx.save();
        offCtx.beginPath(); offCtx.rect(x+1, y+1, CELL-2, CELL-2); offCtx.clip();
        offCtx.strokeStyle = 'rgba(93,173,226,.07)'; offCtx.lineWidth = .5;
        offCtx.beginPath();
        for (let d = -CELL; d < CELL*2; d += 9) {
          offCtx.moveTo(x+d, y); offCtx.lineTo(x+d+CELL, y+CELL);
        }
        offCtx.stroke();
        offCtx.restore();
      }
    }

    // Rótulos A B C… e 1 2 3… (estáticos, ficam no offscreen)
    offCtx.font = `${Math.max(5, Math.floor(CELL * 0.18))}px "Space Mono",monospace`;
    offCtx.fillStyle = 'rgba(93,173,226,.18)';
    offCtx.textAlign = 'center'; offCtx.textBaseline = 'middle';
    for (let c = 0; c < COLS; c++) offCtx.fillText(String.fromCharCode(65+c), c*CELL+CELL/2, 6);
    offCtx.textAlign = 'right';
    for (let r = 0; r < ROWS; r++) offCtx.fillText(r+1, 8, r*CELL+CELL/2);

    mapaPreRend = true;
  }

  // ── Elementos visuais dos bugs (DOM overlay) ────────────
  function _criarBugEls() {
    bugLayer.innerHTML = '';
    return bugs.map(bug => {
      const el = document.createElement('div');
      el.className = 'bug-el';
      el.textContent = bug.emoji;
      // Consolida todos os estilos em uma única atribuição
      el.style.cssText = `left:${bug.c*CELL}px;top:${bug.r*CELL}px;width:${CELL}px;height:${CELL}px;font-size:${Math.floor(CELL*0.52)}px`;
      bugLayer.appendChild(el);
      return el;
    });
  }

  let bugEls = [];

  // Contador de frames para reduzir frequência do glitch no mobile
  let frameCount = 0;

  function _atualizarBugEls(ts) {
    bugs.forEach((bug, i) => {
      if (!bug.vivo) return;
      const gs = glitchStates[i];
      const p  = Math.sin(bugPhases[i]) * 0.5 + 0.5;
      bugPhases[i] += 0.035;

      if (ts > gs.nextGlitch && !gs.glitching) {
        gs.glitching = true;
        gs.glitchEnd = ts + 80 + Math.random() * 140;
        gs.ox   = (Math.random() - 0.5) * 7;
        gs.oy   = (Math.random() - 0.5) * 7;
        gs.skew = (Math.random() - 0.5) * 18;
      }
      if (gs.glitching && ts > gs.glitchEnd) {
        gs.glitching = false;
        gs.ox = 0; gs.oy = 0; gs.skew = 0;
        gs.nextGlitch = ts + 900 + Math.random() * 2800;
      }

      const mx    = gs.glitching ? (Math.random() - 0.5) * 4 : 0;
      const my    = gs.glitching ? (Math.random() - 0.5) * 4 : 0;
      const scale = 0.9 + p * 0.18;
      const el    = bugEls[i];

      // Consolida todas as propriedades de estilo em uma única string
      // evitando múltiplos reflows por bug por frame
      const filterVal = gs.glitching
        ? `drop-shadow(0 0 ${(8+p*10).toFixed(1)}px rgba(255,50,50,${(0.5+p*0.5).toFixed(2)}))`
        : `drop-shadow(0 0 ${(4+p*8).toFixed(1)}px rgba(224,85,85,${(0.3+p*0.5).toFixed(2)}))`;

      const opacity = (gs.glitching && Math.random() < 0.3)
        ? (Math.random() < 0.5 ? '0.3' : '1') : '1';

      el.style.cssText = `left:${(bug.c*CELL+gs.ox+mx).toFixed(1)}px;top:${(bug.r*CELL+gs.oy+my).toFixed(1)}px;width:${CELL}px;height:${CELL}px;font-size:${Math.floor(CELL*0.52)}px;transform:scale(${scale.toFixed(3)}) skewX(${gs.skew.toFixed(1)}deg);filter:${filterVal};opacity:${opacity};display:flex;align-items:center;justify-content:center;position:absolute;line-height:1;transform-origin:center center;pointer-events:none;transition:opacity .3s`;
    });
  }

  // ── Loop de animação e desenho ──────────────────────────
  function _loop(ts) {
    frameCount++;

    // Suaviza posição da nave
    const tx = pos.c * CELL + CELL / 2;
    const ty = pos.r * CELL + CELL / 2;
    animPx += (tx - animPx) * 0.22;
    animPy += (ty - animPy) * 0.22;

    // Suaviza ângulo
    const anguloAlvo = DIRS[direcao].angle;
    let da = anguloAlvo - animAngle;
    while (da >  Math.PI) da -= Math.PI * 2;
    while (da < -Math.PI) da += Math.PI * 2;
    animAngle += da * 0.22;

    // Atualiza partículas com arrays tipados
    for (let i = 0; i < pCount; i++) {
      pX[i]  += pVX[i]; pY[i]  += pVY[i];
      pVX[i] *= 0.87;   pVY[i] *= 0.87;
      pL[i]  -= 0.055;
    }
    // Remove partículas mortas compactando o array
    let alive = 0;
    for (let i = 0; i < pCount; i++) {
      if (pL[i] > 0) {
        if (alive !== i) {
          pX[alive]=pX[i]; pY[alive]=pY[i];
          pVX[alive]=pVX[i]; pVY[alive]=pVY[i];
          pL[alive]=pL[i]; pCol[alive]=pCol[i];
        }
        alive++;
      }
    }
    pCount = alive;

    // Atualiza bugs DOM
    _atualizarBugEls(ts);

    const W = cv.width, H = cv.height;

    // Pré-renderiza o mapa se ainda não foi feito
    if (!mapaPreRend) _preRenderizarMapa();

    // Copia o mapa pré-renderizado para o canvas principal
    ctx.drawImage(offscreen, 0, 0);

    // Halo dos bugs (dinâmico — pulsa com o tempo)
    bugs.forEach((bug, i) => {
      if (!bug.vivo) return;
      const p  = Math.sin(bugPhases[i]) * 0.5 + 0.5;
      const gs = glitchStates[i];
      const bx = bug.c * CELL + CELL / 2;
      const by = bug.r * CELL + CELL / 2;
      ctx.beginPath(); ctx.arc(bx, by, 13 + p*4, 0, Math.PI*2);
      ctx.fillStyle = gs.glitching
        ? `rgba(255,50,50,${(0.06+p*0.12).toFixed(2)})`
        : `rgba(224,85,85,${(0.04+p*0.09).toFixed(2)})`;
      ctx.fill();
      ctx.beginPath(); ctx.arc(bx, by, 10 + p*3, 0, Math.PI*2);
      ctx.strokeStyle = gs.glitching
        ? `rgba(255,50,50,${(0.4+p*0.6).toFixed(2)})`
        : `rgba(224,85,85,${(0.2+p*0.6).toFixed(2)})`;
      ctx.lineWidth = 0.8 + p; ctx.stroke();
    });

    // Destaque sutil da célula da nave
    ctx.fillStyle = 'rgba(93,173,226,.07)';
    ctx.fillRect(pos.c*CELL+1, pos.r*CELL+1, CELL-2, CELL-2);

    // Partículas
    for (let i = 0; i < pCount; i++) {
      ctx.beginPath();
      ctx.arc(pX[i], pY[i], 2.5*pL[i], 0, Math.PI*2);
      ctx.fillStyle = pCol[i] === 0
        ? `rgba(93,173,226,${pL[i].toFixed(2)})`
        : `rgba(232,160,32,${pL[i].toFixed(2)})`;
      ctx.fill();
    }

    // Desenho da nave
    ctx.save();
    ctx.translate(animPx, animPy);
    ctx.rotate(animAngle + Math.PI / 2);
    // Aura
    ctx.beginPath(); ctx.arc(0, 0, Math.floor(CELL * 0.44), 0, Math.PI*2);
    ctx.fillStyle = 'rgba(93,173,226,.07)'; ctx.fill();
    ctx.strokeStyle = 'rgba(93,173,226,.22)'; ctx.lineWidth = .8; ctx.stroke();
    // Corpo
    const s = CELL * 0.32;
    ctx.beginPath();
    ctx.moveTo(0, -s); ctx.lineTo(s*0.6, s*0.6);
    ctx.lineTo(0, s*0.2); ctx.lineTo(-s*0.6, s*0.6);
    ctx.closePath();
    ctx.fillStyle = '#5dade2'; ctx.fill();
    ctx.strokeStyle = 'rgba(93,173,226,.8)'; ctx.lineWidth = .5; ctx.stroke();
    // Chama do propulsor
    const ep = Math.abs(Math.sin(ts * 0.012)) * 0.4 + 0.3;
    ctx.fillStyle = `rgba(93,173,226,${(ep*0.6).toFixed(2)})`;
    ctx.beginPath();
    ctx.moveTo(-s*0.25, s*0.35); ctx.lineTo(s*0.25, s*0.35);
    ctx.lineTo(s*0.15, s*0.35+ep*s*0.7); ctx.lineTo(-s*0.15, s*0.35+ep*s*0.7);
    ctx.closePath(); ctx.fill();
    ctx.restore();

    rafId = requestAnimationFrame(_loop);
  }

  // Inicia (ou reinicia) o loop de animação do canvas
  function _iniciarLoop() {
    if (rafId) cancelAnimationFrame(rafId);
    frameCount = 0;
    rafId = requestAnimationFrame(_loop);
  }

  // Gera partículas de explosão usando arrays tipados pré-alocados
  function _spawnParticulas(x, y) {
    const count = Math.min(12, MAX_PARTICLES - pCount);
    for (let i = 0; i < count; i++) {
      const a   = Math.random() * Math.PI * 2;
      const spd = Math.random() * 2.5 + 0.8;
      const idx = pCount++;
      pX[idx]   = x; pY[idx]   = y;
      pVX[idx]  = Math.cos(a)*spd; pVY[idx] = Math.sin(a)*spd;
      pL[idx]   = 1;
      pCol[idx] = Math.random() < 0.5 ? 0 : 1;
    }
  }

  // ── Funções auxiliares de interface ────────────────────
  function _setLog(html) { document.getElementById('log').innerHTML = html; }

  function _setStatus(txt, cor) {
    const el = document.getElementById('h-status');
    el.textContent = txt;
    el.style.color = cor || '#5dade2';
  }

  // Atualiza o HUD e o título da fase no cabeçalho
  function _atualizarHUD() {
    const coletados = bugs.filter(b => !b.vivo).length;
    document.getElementById('h-fase').textContent  = faseNum + '/5';
    document.getElementById('h-steps').textContent = passos || '—';
    document.getElementById('h-bugs').textContent  = coletados + '/' + bugs.length;
    document.getElementById('game-header-title').textContent = faseAtual.titulo;
  }

  const CMD_CHARS = { frente: '▲', esq: '↺', dir: '↻', coletar: '⚡' };

  // Redesenha todos os blocos de comando na fila visual e reposiciona o cursor de inserção
  function _renderizarFila() {
    const fila = document.getElementById('fila-comandos');
    const countEl = document.getElementById('q-count');
    if (countEl) countEl.style.display = 'none';

    // Limpa fila atual mantendo a funcionalidade de re-criar
    fila.innerHTML = '';

    if (comandos.length === 0) {
      const vazia = document.createElement('p');
      vazia.id = 'msg-vazia';
      vazia.textContent = 'nenhum comando adicionado';
      fila.appendChild(vazia);
      
      if (!executando) {
        const cur = document.createElement('div');
        cur.className = 'cursor-insercao';
        fila.appendChild(cur);

        const espacoExtra = document.createElement('div');
        espacoExtra.style.flexGrow = '1';
        espacoExtra.style.width = '100%';
        espacoExtra.addEventListener('click', () => {
          if (!executando) { cursorIndex = comandos.length; _renderizarFila(); }
        });
        fila.appendChild(espacoExtra);
      }
      return;
    }

    if (cursorIndex > comandos.length) cursorIndex = comandos.length;

    const frag = document.createDocumentFragment();

    comandos.forEach((cmd, idx) => {
      // Inserir o cursor de edição se for o local certo
      if (!executando && idx === cursorIndex) {
        const cur = document.createElement('div');
        cur.className = 'cursor-insercao';
        frag.appendChild(cur);
      }

      const b = document.createElement('div');
      b.id = 'qi-' + idx;
      b.className = 'bloco-comando' + (cmd === 'coletar' ? ' capture' : '');
      b.title = cmd;

      // Span com o símbolo/texto do comando
      const spanText = document.createElement('span');
      spanText.className = 'cmd-text';
      spanText.textContent = CMD_CHARS[cmd] ?? cmd;
      b.appendChild(spanText);

      // Botão de remover que não afeta a seleção
      const spanDel = document.createElement('span');
      spanDel.className = 'cmd-del';
      spanDel.textContent = '✕';
      spanDel.title = 'Remover';
      spanDel.addEventListener('click', (e) => {
        e.stopPropagation();
        if (!executando) {
          comandos.splice(idx, 1);
          if (cursorIndex > idx) cursorIndex--;
          else if (cursorIndex === comandos.length + 1) cursorIndex--;
          _renderizarFila();
        }
      });
      b.appendChild(spanDel);

      // Clicar no bloco muda o cursor de inserção para antes dele
      b.addEventListener('click', () => {
        if (!executando) {
          cursorIndex = idx;
          _renderizarFila();
        }
      });

      frag.appendChild(b);
    });

    // Se o cursor estiver no final
    if (!executando && cursorIndex === comandos.length) {
      const cur = document.createElement('div');
      cur.className = 'cursor-insercao';
      frag.appendChild(cur);
    }

    // Área flexível invisível para permitir clique no final da fila com facilidade
    if (!executando) {
      const espacoExtra = document.createElement('div');
      espacoExtra.style.flexGrow = '1';
      espacoExtra.style.alignSelf = 'stretch';
      espacoExtra.style.minWidth = '30px';
      espacoExtra.addEventListener('click', () => {
        if (!executando) { cursorIndex = comandos.length; _renderizarFila(); }
      });
      frag.appendChild(espacoExtra);
    }

    fila.appendChild(frag);
    fila.scrollTop = fila.scrollHeight;
  }

  // Destaca visualmente o comando em execução e esmaece os já executados
  function _destacarComando(idx) {
    document.querySelectorAll('.bloco-comando').forEach((b, i) => {
      b.className = 'bloco-comando'
        + (comandos[i] === 'coletar' ? ' capture' : '')
        + (i < idx ? ' feito' : i === idx ? ' ativo' : '');
    });
  }

  // ── Inicialização da fase ───────────────────────────────
  function init(fase, _gridId, numFase) {
    faseAtual  = fase;
    faseNum    = numFase ?? 1;
    pos        = { r: fase.inicio.r, c: fase.inicio.c };
    direcao    = fase.direcaoInicial ?? 0;
    executando = false;
    passos     = 0;
    comandos   = [];
    cursorIndex = 0;
    pCount     = 0; // limpa partículas

    // Coleta posições de bug (tipo 3) do mapa
    bugs = [];
    for (let r = 0; r < fase.mapa.length; r++) {
      for (let c = 0; c < fase.mapa[r].length; c++) {
        if (fase.mapa[r][c] === 3) {
          bugs.push({ r, c, emoji: _sortearEmoji(), vivo: true });
        }
      }
    }

    // Inicializa estados de glitch para cada bug
    glitchStates = bugs.map(() => ({
      ox: 0, oy: 0, skew: 0, glitching: false,
      nextGlitch: 800 + Math.random() * 1500, glitchEnd: 0
    }));
    bugPhases = bugs.map(() => Math.random() * Math.PI * 2);

    _setCanvasSize(fase.mapa.length, fase.mapa[0].length);
    animPx    = pos.c * CELL + CELL / 2;
    animPy    = pos.r * CELL + CELL / 2;
    animAngle = DIRS[direcao].angle;

    bugEls = _criarBugEls();

    _setStatus('PRONTO');
    _atualizarHUD();
    _renderizarFila();
    _setLog('aguardando programação da rota de missão...');
    _iniciarLoop();
  }

  // ── Adição de comandos ──────────────────────────────────
  function adicionarComando(tipo) {
    if (executando) return;
    if (cursorIndex > comandos.length) cursorIndex = comandos.length;
    
    comandos.splice(cursorIndex, 0, tipo);
    cursorIndex++;
    
    _renderizarFila();
    _setLog('adicionado: <span class="ok">' + CMD_CHARS[tipo] + ' ' + tipo.toUpperCase() + '</span>');
  }

  function limparComandos() {
    if (executando) return;
    comandos = [];
    cursorIndex = 0;
    _renderizarFila();
    _setLog('fila limpa · pronto');
  }

  // ── Execução da sequência ───────────────────────────────
  async function executar() {
    if (executando || comandos.length === 0) return;
    executando = true;
    _renderizarFila(); // Re-renderizar para esconder cursor de edição

    passos = 0;
    document.getElementById('btn-executar').disabled = true;
    _setStatus('EXECUTANDO', '#e8a020');

    for (let i = 0; i < comandos.length; i++) {
      const cmd = comandos[i];
      _destacarComando(i);
      await _sleep(400);

      if (cmd === 'frente') {
        const d  = DIRS[direcao];
        const nr = pos.r + d.dr;
        const nc = pos.c + d.dc;
        const v  = faseAtual.mapa[nr] && faseAtual.mapa[nr][nc];
        if (nr >= 0 && nr < ROWS && nc >= 0 && nc < COLS && (v === 1 || v === 3)) {
          pos = { r: nr, c: nc };
          passos++;
          _atualizarHUD();
          _setLog('<span class="ok">▲ AVANÇAR · [' + String.fromCharCode(65+pos.c) + (pos.r+1) + ']</span>');
        } else {
          _setLog('<span class="warn">BLOQUEADO · parede detectada</span>');
          const el = document.getElementById('qi-' + i);
          if (el) el.className = 'bloco-comando falha';
          await _sleep(300);
          _erro('Colisão detectada! A nave não pode avançar.');
          return;
        }
      } else if (cmd === 'esq') {
        direcao = (direcao + 3) % 4;
        _setLog('<span class="ok">↺ GIRAR ESQ.</span>');
      } else if (cmd === 'dir') {
        direcao = (direcao + 1) % 4;
        _setLog('<span class="ok">↻ GIRAR DIR.</span>');
      } else if (cmd === 'coletar') {
        // Busca bug vivo na posição atual
        let bugIdx = -1;
        for (let j = 0; j < bugs.length; j++) {
          if (bugs[j].vivo && bugs[j].r === pos.r && bugs[j].c === pos.c) { bugIdx = j; break; }
        }
        if (bugIdx >= 0) {
          const bugAqui = bugs[bugIdx];
          bugAqui.vivo = false;
          bugEls[bugIdx].style.opacity = '0';
          _spawnParticulas(pos.c * CELL + CELL/2, pos.r * CELL + CELL/2);
          _atualizarHUD();
          _setLog('<span class="win">⚡ BUG CAPTURADO · ' + bugAqui.emoji + ' patch aplicado!</span>');
          // Verifica se todos foram coletados
          let todos = true;
          for (let j = 0; j < bugs.length; j++) { if (bugs[j].vivo) { todos = false; break; } }
          if (todos) { await _sleep(300); _sucesso(); return; }
        } else {
          _setLog('<span class="warn">⚡ NENHUM BUG AQUI</span>');
          const el = document.getElementById('qi-' + i);
          if (el) el.className = 'bloco-comando capture falha';
          await _sleep(300);
          _erro('Nenhum bug nesta posição. Reposicione a nave.');
          return;
        }
      }
    }

    let restantes = 0;
    for (let j = 0; j < bugs.length; j++) { if (bugs[j].vivo) restantes++; }
    _erro('Sequência incompleta. Ainda há ' + restantes + ' bug(s) para capturar!');
  }

  // ── Reinicialização ────────────────────────────────────
  function _reiniciar(limparFila) {
    pos        = { r: faseAtual.inicio.r, c: faseAtual.inicio.c };
    direcao    = faseAtual.direcaoInicial ?? 0;
    executando = false;
    passos     = 0;
    pCount     = 0;
    animPx     = pos.c * CELL + CELL / 2;
    animPy     = pos.r * CELL + CELL / 2;

    // Ressuscita todos os bugs
    for (let i = 0; i < bugs.length; i++) {
      bugs[i].vivo = true;
      bugEls[i].style.opacity = '1';
    }

    if (limparFila) { comandos = []; cursorIndex = 0; _renderizarFila(); }
    else { _renderizarFila(); } // Restaura cursor
    
    document.getElementById('btn-executar').disabled = false;
    _setStatus('PRONTO');
    _atualizarHUD();
    _setLog('sistema reiniciado · pronto para nova sequencia');
    document.querySelectorAll('.bloco-comando').forEach(b => {
      b.className = 'bloco-comando' + (b.classList.contains('capture') ? ' capture' : '');
    });
  }

  // ── Janela de feedback (modal) ──────────────────────────
  function _erro(msg) {
    executando = false;
    _renderizarFila(); // Restaura cursor na interface
    document.getElementById('btn-executar').disabled = false;
    _setStatus('FALHA', '#e05555');
    _mostrarModal('❌', 'FALHA NA MISSÃO', msg, null, 'TENTAR NOVAMENTE', '#5dade2',
      function() { _reiniciar(false); });
  }

  function _sucesso() {
    executando = false;
    _renderizarFila(); // Restaura cursor na interface
    document.getElementById('btn-executar').disabled = false;
    _setStatus('COMPLETO', '#5dade2');
    const temProxima = !!faseAtual.proximaFase;
    if (!temProxima) {
      _mostrarModal('🚀', 'MISSÃO CONCLUÍDA!',
        'Incrível! Você capturou todos os bugs e salvou a missão Apollo 11. Chegamos à Lua!',
        faseAtual.curiosidade ?? null,
        'RECOMEÇAR', '#e8a020',
        function() { Engine.init(FASE1, 'game-canvas', 1); },
        'Não, obrigado', 
        function() { 
          document.getElementById('container-jogo').style.display = 'none';
          document.getElementById('tela-inicial').style.display = 'flex';
        }
      );
    } else {
      _mostrarModal('🏆', 'FASE CONCLUÍDA!',
        'Todos os bugs capturados! Sistema estabilizado.',
        faseAtual.curiosidade ?? null,
        'PRÓXIMA MISSÃO ▶', '#e8a020',
        function() { faseAtual.proximaFase(); });
    }
  }

  // Exibe o modal com curiosidade e até dois botões de ação
  function _mostrarModal(emoji, titulo, msg, curiosidade, btnLabel, cor, callback, btn2Label, callback2) {
    document.getElementById('modal-emoji').textContent = emoji;
    document.getElementById('modal-title').textContent = titulo;
    document.getElementById('modal-title').style.color = cor;
    document.getElementById('modal-msg').textContent   = msg;

    const curiosEl = document.getElementById('modal-curiosidade');
    if (curiosidade && curiosEl) {
      curiosEl.textContent = '💡 ' + curiosidade;
      curiosEl.style.display = 'block';
    } else if (curiosEl) {
      curiosEl.style.display = 'none';
    }

    const oldBtn = document.getElementById('modal-btn');
    const btn    = oldBtn.cloneNode(true);
    oldBtn.parentNode.replaceChild(btn, oldBtn);
    btn.textContent = btnLabel;
    btn.className   = 'modal-btn' + (cor === '#e8a020' ? ' amber' : '');

    const oldBtn2 = document.getElementById('modal-btn2');
    if (btn2Label && oldBtn2) {
      const btn2 = oldBtn2.cloneNode(true);
      oldBtn2.parentNode.replaceChild(btn2, oldBtn2);
      btn2.textContent = btn2Label;
      btn2.style.display = 'block';
      btn2.addEventListener('click', function() {
        document.getElementById('modal-overlay').classList.remove('show');
        if (callback2) callback2();
      });
    } else if (oldBtn2) {
      oldBtn2.style.display = 'none';
    }

    const box = document.getElementById('modal-box');
    box.style.borderColor = cor;
    box.style.boxShadow   = '0 0 40px ' + cor + '33';
    document.getElementById('modal-overlay').classList.add('show');
    btn.addEventListener('click', function() {
      document.getElementById('modal-overlay').classList.remove('show');
      callback();
    });
  }

  // Utilitário de delay
  function _sleep(ms) { return new Promise(function(r) { setTimeout(r, ms); }); }

  // ── API pública ─────────────────────────────────────────
  return { init: init, adicionarComando: adicionarComando, limparComandos: limparComandos, executar: executar };

})();