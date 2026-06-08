// AIPLAYBOOK — T-Pose panel
//
// Surfaces the `poses` block as a visible, independent section. Each T-Pose is
// the reference an artist hands to Antigravity to generate a direction's
// actions. The artist toggles `enabled` to opt a pose in/out, and clicking a
// pose focuses the actions derived from it (`sourcePose`) so you can review
// "this T-Pose → these converted moves" at a glance.
import { bus, EV } from './bus.js';
import { setPoseEnabled, getUnits } from './atlas-model.js';

let focusedPose = null;

/**
 * Render the T-Pose thumbnails into `container`.
 * @param {any} atlas
 * @param {HTMLElement} container
 * @param {(path: string) => string} resolveSrc  Map a stored image path to a loadable URL.
 */
export function renderPoses(atlas, container, resolveSrc) {
  const poses = atlas.poses || {};
  const ids = Object.keys(poses);
  container.innerHTML = '';

  if (ids.length === 0) {
    container.innerHTML = '<p class="muted-note">No T-Pose set. Drop reference poses, or load a character with a <code>poses</code> block.</p>';
    return;
  }

  for (const id of ids) {
    const p = poses[id];
    const card = document.createElement('div');
    card.className = 'pose-card' + (p.enabled === false ? ' pose-off' : '') + (focusedPose === id ? ' pose-focus' : '');
    card.dataset.pose = id;

    const thumb = document.createElement('div');
    thumb.className = 'pose-thumb';
    if (p.image) {
      const img = document.createElement('img');
      img.src = resolveSrc ? resolveSrc(p.image) : p.image;
      img.alt = p.label || id;
      img.loading = 'lazy';
      thumb.appendChild(img);
    } else {
      thumb.textContent = (p.direction || id).slice(0, 1).toUpperCase();
    }

    const meta = document.createElement('div');
    meta.className = 'pose-meta';
    const derived = getUnits(atlas).filter((u) => u.sourcePose === id).length;
    meta.innerHTML = `<span class="pose-name">${p.label || id}</span>
      <span class="pose-sub">${p.direction || '—'} · ${derived} action${derived === 1 ? '' : 's'}</span>`;

    const toggle = document.createElement('label');
    toggle.className = 'pose-toggle';
    toggle.title = 'Use this T-Pose';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = p.enabled !== false;
    cb.addEventListener('change', (e) => {
      e.stopPropagation();
      setPoseEnabled(atlas, id, cb.checked);
      card.classList.toggle('pose-off', !cb.checked);
    });
    toggle.appendChild(cb);

    // Clicking the card (not the toggle) focuses the pose → highlight its actions.
    card.addEventListener('click', () => {
      focusedPose = focusedPose === id ? null : id;
      bus.emit(EV.POSE_FOCUS, { id: focusedPose });
      // Re-render to move the focus ring without rebuilding the whole left panel.
      renderPoses(atlas, container, resolveSrc);
    });

    card.append(thumb, meta, toggle);
    container.appendChild(card);
  }
}

/** Which pose is currently focused (or null). Editor uses it to dim non-derived actions. */
export function getFocusedPose() {
  return focusedPose;
}
