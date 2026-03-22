const FASE1 = {
  titulo:         'FASE 1 — DECOLAGEM',
  direcaoInicial: 0,   // aponta para a direita

  inicio: { r: 3, c: 0 },

  // Mapa: 0 = parede, 1 = caminho, 3 = bug
  mapa: [
    [ 0, 0, 0, 0, 0, 0, 0, 0 ],
    [ 0, 0, 0, 0, 0, 0, 0, 0 ],
    [ 0, 0, 0, 0, 0, 0, 0, 0 ],
    [ 1, 1, 1, 1, 1, 1, 1, 3 ],  // bug em (3,7)
    [ 0, 0, 0, 0, 0, 0, 0, 0 ],
    [ 0, 0, 0, 0, 0, 0, 0, 0 ],
    [ 0, 0, 0, 0, 0, 0, 0, 0 ],
    [ 0, 0, 0, 0, 0, 0, 0, 0 ],
  ],

  curiosidade: 'O computador do Apollo 11 tinha apenas 72 KB de armazenamento. Uma foto tirada hoje ocupa cerca de 40 vezes mais espaço!',

  proximaFase: () => Engine.init(FASE2, 'game-canvas', 2),
};
