// AI Sprite Studio — procedural fallback
//
// When the editor is opened from file:// (no static server) the reimu fetch is
// blocked by CORS, so we draw a throwaway robot spritesheet on a canvas and ship
// a matching atlas. This is ONLY for instant out-of-the-box play in the editor —
// it is not part of the sprite pipeline and never touches real assets.
export function generateMockSheet() {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');

  const draw = (cx, cy, frame, anim) => {
    ctx.save();
    ctx.translate(cx, cy);
    let bob = 0;
    if (anim === 'idle') bob = Math.sin(frame * Math.PI) * 4;
    else if (anim === 'run') { bob = Math.sin(frame * Math.PI * 2) * 6; ctx.rotate((frame === 0 ? 5 : -5) * Math.PI / 180); }
    else if (anim === 'hit') { ctx.scale(1.2, 0.8); ctx.rotate(15 * Math.PI / 180); }

    ctx.beginPath();
    ctx.ellipse(0, 48, 28, 8, 0, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0,0,0,0.2)';
    ctx.fill();
    ctx.translate(0, bob);

    const g = ctx.createRadialGradient(-10, -10, 5, 0, 0, 40);
    g.addColorStop(0, '#a5b4fc');
    g.addColorStop(1, '#6366f1');
    ctx.beginPath();
    ctx.arc(0, 0, 36, 0, Math.PI * 2);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.strokeStyle = '#4f46e5';
    ctx.lineWidth = 3;
    ctx.stroke();

    ctx.fillStyle = '#09090b';
    ctx.beginPath();
    ctx.roundRect(-22, -12, 44, 20, 8);
    ctx.fill();
    ctx.fillStyle = anim === 'hit' ? '#ec4899' : '#10b981';
    ctx.beginPath();
    ctx.arc(-11, -2, 5, 0, Math.PI * 2);
    ctx.arc(11, -2, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  };

  ctx.clearRect(0, 0, 512, 512);
  draw(64, 64, 0, 'idle');
  draw(192, 64, 1, 'idle');
  draw(64, 192, 0, 'run');
  draw(192, 192, 1, 'run');
  draw(64, 320, 0, 'hit');

  const cell = (x, y) => ({
    frame: { x, y, w: 128, h: 128 }, rotated: false, trimmed: false,
    spriteSourceSize: { x: 0, y: 0, w: 128, h: 128 }, sourceSize: { w: 128, h: 128 },
    anchor: { x: 0.5, y: 0.85 }, duration: 150,
  });

  const atlas = {
    meta: { image: 'mock-sheet.png', size: { w: 512, h: 512 }, scale: '1' },
    assetType: 'character',
    poses: {},
    frames: {
      idle_00: cell(0, 0), idle_01: cell(128, 0),
      run_00: cell(0, 128), run_01: cell(128, 128),
      hit_00: cell(0, 256),
    },
    animations: { idle: ['idle_00', 'idle_01'], run: ['run_00', 'run_01'], hit: ['hit_00'] },
    animationConfig: {
      idle: { onEnd: 'loop', fps: 6 }, run: { onEnd: 'loop', fps: 10 }, hit: { onEnd: 'idle', fps: 8 },
    },
    states: {
      initial: 'idle',
      definitions: {
        idle: { animation: 'idle', loop: true, onEnd: 'loop', transitions: { MOVE: { target: 'run' }, DAMAGE: { target: 'hit' } } },
        run: { animation: 'run', loop: true, onEnd: 'loop', transitions: { STOP: { target: 'idle' }, DAMAGE: { target: 'hit' } } },
        hit: { animation: 'hit', loop: false, onEnd: 'idle', transitions: {} },
      },
    },
  };

  return { imageUrl: canvas.toDataURL('image/png'), atlas };
}
