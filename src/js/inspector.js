// ---------------------------------------------------------------------------
// MotionForge — inspector (properties + effects)
// ---------------------------------------------------------------------------

import {
  store,
  clamp,
  getValue,
  isAnimated,
  keyframeAt,
  toggleKeyframe,
  setAnimatable,
  setBaseValue,
  createEffect,
  EFFECT_DEFS,
  EFFECT_GROUPS,
  TRANSFORM_PROPS,
  BLEND_MODES,
  FONT_FAMILIES,
  TYPE_NAMES,
} from './core.js';
import { el, $, $$, toast } from './ui.js';

let tab = 'props';
let bindings = [];
let kfButtons = [];
const collapsed = new Set();

export function initInspector() {
  for (const btn of $$('.tab')) {
    btn.addEventListener('click', () => {
      tab = btn.dataset.tab;
      for (const b of $$('.tab')) b.classList.toggle('active', b === btn);
      build();
    });
  }

  store.on('project', build);
  store.on('selection', build);
  store.on('time', refreshDynamic);
  store.on('transform', refreshDynamic);

  build();
}

function build() {
  const host = $('#inspector');
  if (!host) return;
  host.innerHTML = '';
  bindings = [];
  kfButtons = [];

  const layer = store.selectedLayer;
  if (!layer) {
    host.append(
      el('div', {
        class: 'empty-state',
        html: '<strong>Nothing selected</strong>Select a layer on the canvas or in the timeline to edit it.',
      })
    );
    return;
  }

  host.append(buildHeader(layer));
  if (tab === 'props') buildProps(host, layer);
  else buildEffects(host, layer);

  host.append(buildFooter(layer));
  refreshDynamic();
}

// ---------------------------------------------------------------------------

function buildHeader(layer) {
  const head = el('div', { class: 'layer-head' });
  head.append(el('span', { class: 'layer-type-badge', text: TYPE_NAMES[layer.type] || layer.type }));
  const name = el('input', {
    class: 'layer-name-input',
    value: layer.name,
    spellcheck: 'false',
  });
  name.addEventListener('change', () => {
    store.act(() => {
      layer.name = name.value || TYPE_NAMES[layer.type];
    });
    store.emit('project');
  });
  head.append(name);

  const wrap = el('div', {}, head);
  const blend = el(
    'div',
    { class: 'field-inline' },
    el('span', { text: 'Blend' }),
    el(
      'select',
      { onchange: (e) => {
        store.act(() => {
          layer.blend = e.target.value;
        });
        store.emit('project');
      } },
      ...BLEND_MODES.map(([value, label]) => el('option', { value, selected: layer.blend === value, text: label }))
    )
  );
  wrap.append(blend);
  return wrap;
}

function buildFooter(layer) {
  const wrap = el('div', { class: 'section', style: { marginTop: '18px' } });
  const row = el('div', { style: { display: 'flex', gap: '8px' } });

  row.append(
    el('button', {
      class: 'btn tiny',
      text: 'Duplicate',
      onclick: () => {
        store.duplicateLayer(layer.id);
        toast('Layer duplicated', 'ok', 1500);
      },
    }),
    el('button', {
      class: 'btn tiny',
      text: 'Delete layer',
      style: { color: '#ff8792' },
      onclick: () => {
        store.removeLayer(layer.id);
        toast('Layer deleted', '', 1500);
      },
    })
  );
  wrap.append(row);
  return wrap;
}

// ---------------------------------------------------------------------------

function section(title, ...children) {
  return el('div', { class: 'section' }, el('div', { class: 'section-title' }, el('span', { text: title })), ...children);
}

function buildProps(host, layer) {
  // ---- transform ---------------------------------------------------------
  const comp = store.project;
  const transformRows = TRANSFORM_PROPS.map((p) => {
    if (p.key === 'x') {
      return propRow(layer, 'transform.x', {
        label: 'Position X',
        min: -comp.width,
        max: comp.width * 2,
        sliderMin: -comp.width * 0.25,
        sliderMax: comp.width * 1.25,
        step: 1,
      });
    }
    if (p.key === 'y') {
      return propRow(layer, 'transform.y', {
        label: 'Position Y',
        min: -comp.height,
        max: comp.height * 2,
        sliderMin: -comp.height * 0.25,
        sliderMax: comp.height * 1.25,
        step: 1,
      });
    }
    if (p.key === 'scale') {
      return propRow(layer, 'transform.scale', {
        label: 'Scale',
        min: 0,
        max: 20,
        sliderMin: 0,
        sliderMax: 3,
        step: 0.01,
      });
    }
    if (p.key === 'rotation') {
      return propRow(layer, 'transform.rotation', {
        label: 'Rotation',
        min: -3600,
        max: 3600,
        sliderMin: -180,
        sliderMax: 180,
        step: 0.1,
      });
    }
    return propRow(layer, 'transform.opacity', { label: 'Opacity', min: 0, max: 100, step: 0.1 });
  });

  host.append(section('Transform', ...transformRows));

  if (layer.type === 'text') host.append(buildTextSection(layer));
  if (layer.type === 'shape' || layer.type === 'solid') host.append(buildShapeSection(layer));
  if (layer.type === 'image' || layer.type === 'video') host.append(buildMediaSection(layer));
}

// ---------------------------------------------------------------------------

function propRow(layer, path, cfg) {
  const digits = cfg.step >= 1 ? 0 : 2;
  const row = el('div', { class: 'prop-row' });

  row.append(el('span', { class: 'prop-label', text: cfg.label, title: cfg.label }));

  const slider = el('input', {
    type: 'range',
    min: cfg.sliderMin ?? cfg.min,
    max: cfg.sliderMax ?? cfg.max,
    step: cfg.step,
  });

  const num = el('input', {
    class: 'prop-num',
    type: 'number',
    min: cfg.min,
    max: cfg.max,
    step: cfg.step,
  });

  const kf = makeKfButton(layer, path);
  row.append(slider, num, kf);

  const binding = { layer, path, slider, num, digits, cfg };
  bindings.push(binding);

  const current = getValue(layer, path, store.time);
  slider.value = String(clamp(current, Number(slider.min), Number(slider.max)));
  num.value = fmtNum(current, digits);

  slider.addEventListener('pointerdown', () => store.begin());
  slider.addEventListener('input', () => {
    const v = Number(slider.value);
    setAnimatable(layer, path, v, store.time, true);
    num.value = fmtNum(v, digits);
    store.emit('transform');
  });
  const commitSlider = () => {
    store.end();
    store.emit('project');
  };
  slider.addEventListener('change', commitSlider);
  slider.addEventListener('pointerup', commitSlider);

  const commitNum = () => {
    let v = Number(num.value);
    if (!Number.isFinite(v)) v = getValue(layer, path, store.time);
    v = clamp(v, cfg.min, cfg.max);
    store.act(() => setAnimatable(layer, path, v, store.time, true));
    store.emit('project');
  };
  num.addEventListener('change', commitNum);
  num.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') num.blur();
  });

  return row;
}

function makeKfButton(layer, path) {
  const btn = el('button', { class: 'kf-btn', title: 'Toggle keyframe at playhead', html: '<span class="dia"></span>' });
  const update = () => {
    btn.classList.toggle('animated', isAnimated(layer, path));
    btn.classList.toggle('on', !!keyframeAt(layer, path, store.time));
  };
  update();
  btn.addEventListener('click', () => {
    store.act(() => toggleKeyframe(layer, path, store.time));
    store.emit('project');
  });
  btn._update = update;
  kfButtons.push(btn);
  return btn;
}

function fmtNum(v, digits = 2) {
  if (!Number.isFinite(v)) return '0';
  const m = Math.pow(10, digits);
  return String(Math.round(v * m) / m);
}

function refreshDynamic() {
  for (const b of bindings) {
    const v = getValue(b.layer, b.path, store.time);
    if (document.activeElement !== b.num) b.num.value = fmtNum(v, b.digits);
    b.slider.value = String(clamp(v, Number(b.slider.min), Number(b.slider.max)));
  }
  for (const btn of kfButtons) btn._update();
}

// ---------------------------------------------------------------------------
// Text / shape / media sections
// ---------------------------------------------------------------------------

function field(label, control) {
  return el('div', { class: 'field-inline' }, el('span', { text: label }), control);
}

function buildTextSection(layer) {
  const T = layer.text;
  const wrap = el('div');

  const area = el('textarea', { rows: '3' });
  area.value = T.content;
  area.addEventListener('input', () => {
    T.content = area.value;
    store.emit('transform');
  });
  area.addEventListener('change', () => {
    store.act(() => {
      T.content = area.value;
    });
    store.emit('project');
  });

  const font = el(
    'select',
    { onchange: (e) => {
      store.act(() => {
        T.fontFamily = e.target.value;
      });
      store.emit('project');
    } },
    ...FONT_FAMILIES.map((f) => el('option', { value: f, selected: T.fontFamily === f, text: f }))
  );

  const size = el('input', {
    type: 'number',
    min: 4,
    max: 1000,
    step: 1,
    value: T.fontSize,
    onchange: (e) => {
      store.act(() => {
        T.fontSize = clamp(Number(e.target.value) || 12, 4, 1000);
      });
      store.emit('project');
    },
  });

  const weight = el(
    'select',
    { onchange: (e) => {
      store.act(() => {
        T.fontWeight = Number(e.target.value);
      });
      store.emit('project');
    } },
    ...[300, 400, 500, 600, 700, 800, 900].map((w) =>
      el('option', { value: w, selected: T.fontWeight === w, text: String(w) })
    )
  );

  const color = colorField(T.color, (v) => {
    T.color = v;
  });

  const align = el(
    'select',
    { onchange: (e) => {
      store.act(() => {
        T.align = e.target.value;
      });
      store.emit('project');
    } },
    ...[
      ['center', 'Center'],
      ['left', 'Left'],
      ['right', 'Right'],
    ].map(([v, l]) => el('option', { value: v, selected: T.align === v, text: l }))
  );

  const lineHeight = el('input', {
    type: 'number',
    min: 0.5,
    max: 4,
    step: 0.05,
    value: T.lineHeight,
    onchange: (e) => {
      store.act(() => {
        T.lineHeight = clamp(Number(e.target.value) || 1.2, 0.5, 4);
      });
      store.emit('project');
    },
  });

  const maxWidth = el('input', {
    type: 'number',
    min: 20,
    max: 8000,
    step: 1,
    value: T.maxWidth,
    onchange: (e) => {
      store.act(() => {
        T.maxWidth = clamp(Number(e.target.value) || 400, 20, 8000);
      });
      store.emit('project');
    },
  });

  const spacing = el('input', {
    type: 'number',
    min: -50,
    max: 200,
    step: 0.5,
    value: T.letterSpacing,
    onchange: (e) => {
      store.act(() => {
        T.letterSpacing = Number(e.target.value) || 0;
      });
      store.emit('project');
    },
  });

  const strokeWidth = el('input', {
    type: 'number',
    min: 0,
    max: 100,
    step: 0.5,
    value: T.strokeWidth,
    onchange: (e) => {
      store.act(() => {
        T.strokeWidth = Math.max(0, Number(e.target.value) || 0);
      });
      store.emit('project');
    },
  });

  const strokeColor = colorField(T.strokeColor, (v) => {
    T.strokeColor = v;
  });

  const shadowToggle = el('input', {
    type: 'checkbox',
    checked: T.shadow,
    style: { width: '16px', height: '16px' },
    onchange: (e) => {
      store.act(() => {
        T.shadow = e.target.checked;
      });
      store.emit('project');
    },
  });

  const shadowBlur = el('input', {
    type: 'number',
    min: 0,
    max: 200,
    step: 1,
    value: T.shadowBlur,
    onchange: (e) => {
      store.act(() => {
        T.shadowBlur = Math.max(0, Number(e.target.value) || 0);
      });
      store.emit('project');
    },
  });

  wrap.append(
    section(
      'Text',
      field('Content', area),
      field('Font', font),
      el('div', { class: 'grid-2' },
        el('div', { class: 'mini-field' }, el('span', { text: 'Size' }), size),
        el('div', { class: 'mini-field' }, el('span', { text: 'Weight' }), weight)
      ),
      field('Color', color),
      field('Align', align),
      el('div', { class: 'grid-2' },
        el('div', { class: 'mini-field' }, el('span', { text: 'Line height' }), lineHeight),
        el('div', { class: 'mini-field' }, el('span', { text: 'Max width' }), maxWidth)
      ),
      el('div', { class: 'grid-2' },
        el('div', { class: 'mini-field' }, el('span', { text: 'Letter spacing' }), spacing),
        el('div', { class: 'mini-field' }, el('span', { text: 'Stroke width' }), strokeWidth)
      ),
      field('Stroke', strokeColor),
      el('div', { class: 'field-inline' }, el('span', { text: 'Shadow' }), el('div', { style: { display: 'flex', alignItems: 'center', gap: '8px' } }, shadowToggle, shadowBlur))
    )
  );

  return wrap;
}

function buildShapeSection(layer) {
  const S = layer.shape;
  const wrap = el('div');

  const kind = el(
    'select',
    { onchange: (e) => {
      store.act(() => {
        S.kind = e.target.value;
      });
      store.emit('project');
    } },
    ...[
      ['rect', 'Rectangle'],
      ['ellipse', 'Ellipse'],
      ['polygon', 'Polygon'],
      ['triangle', 'Triangle'],
    ].map(([v, l]) => el('option', { value: v, selected: S.kind === v, text: l }))
  );

  const width = numInput(S.width, 1, 8000, (v) => {
    store.act(() => {
      S.width = v;
    });
    store.emit('project');
  });
  const height = numInput(S.height, 1, 8000, (v) => {
    store.act(() => {
      S.height = v;
    });
    store.emit('project');
  });
  const radius = numInput(S.radius, 0, 4000, (v) => {
    store.act(() => {
      S.radius = v;
    });
    store.emit('project');
  });
  const sides = numInput(S.sides, 3, 32, (v) => {
    store.act(() => {
      S.sides = Math.round(v);
    });
    store.emit('project');
  });
  const strokeW = numInput(S.strokeWidth, 0, 200, (v) => {
    store.act(() => {
      S.strokeWidth = v;
    });
    store.emit('project');
  });

  const fill = colorField(S.fill, (v) => {
    S.fill = v;
  });
  const stroke = colorField(S.stroke, (v) => {
    S.stroke = v;
  });

  wrap.append(
    section(
      'Shape',
      field('Type', kind),
      el('div', { class: 'grid-2' },
        el('div', { class: 'mini-field' }, el('span', { text: 'Width' }), width),
        el('div', { class: 'mini-field' }, el('span', { text: 'Height' }), height)
      ),
      S.kind === 'rect'
        ? el('div', { class: 'grid-2' },
            el('div', { class: 'mini-field' }, el('span', { text: 'Corner radius' }), radius),
            el('div', { class: 'mini-field' }, el('span', { text: 'Stroke width' }), strokeW)
          )
        : el('div', { class: 'grid-2' },
            S.kind === 'polygon'
              ? el('div', { class: 'mini-field' }, el('span', { text: 'Sides' }), sides)
              : el('div', {}),
            el('div', { class: 'mini-field' }, el('span', { text: 'Stroke width' }), strokeW)
          ),
      field('Fill', fill),
      field('Stroke', stroke)
    )
  );

  return wrap;
}

function buildMediaSection(layer) {
  const wrap = el('div');
  const w = numInput(layer.width || 300, 1, 8000, (v) => {
    store.act(() => {
      layer.width = v;
    });
    store.emit('project');
  });
  const h = numInput(layer.height || 300, 1, 8000, (v) => {
    store.act(() => {
      layer.height = v;
    });
    store.emit('project');
  });

  const children = [
    section(
      'Media',
      el('div', { class: 'mini-field', style: { marginBottom: '8px' } },
        el('span', { text: 'Source' }),
        el('div', { style: { fontSize: '11px', color: 'var(--dim)', wordBreak: 'break-all' }, text: layer.mediaName || layer.src })
      ),
      el('div', { class: 'grid-2' },
        el('div', { class: 'mini-field' }, el('span', { text: 'Width' }), w),
        el('div', { class: 'mini-field' }, el('span', { text: 'Height' }), h)
      ),
      el('button', {
        class: 'btn tiny',
        style: { marginTop: '8px' },
        text: 'Fit to canvas',
        onclick: () => {
          const entry = layer.mediaW && layer.mediaH ? { w: layer.mediaW, h: layer.mediaH } : null;
          if (!entry) return;
          const maxW = store.project.width * 0.9;
          const maxH = store.project.height * 0.9;
          const s = Math.min(maxW / entry.w, maxH / entry.h, 1);
          store.act(() => {
            layer.width = Math.round(entry.w * s);
            layer.height = Math.round(entry.h * s);
          });
          store.emit('project');
        },
      })
    ),
  ];

  if (layer.type === 'video') {
    const speed = numInput(layer.speed || 1, 0.05, 10, (v) => {
      store.act(() => {
        layer.speed = v;
      });
      store.emit('project');
    }, 0.05);
    const offset = numInput(layer.sourceStart || 0, 0, 3600, (v) => {
      store.act(() => {
        layer.sourceStart = v;
      });
      store.emit('project');
    }, 0.01);
    const volume = numInput(layer.volume == null ? 1 : layer.volume, 0, 1, (v) => {
      store.act(() => {
        layer.volume = clamp(v, 0, 1);
      });
      store.emit('project');
    }, 0.01);

    children.push(
      section(
        'Video',
        el('div', { class: 'grid-2' },
          el('div', { class: 'mini-field' }, el('span', { text: 'Speed' }), speed),
          el('div', { class: 'mini-field' }, el('span', { text: 'Source offset (s)' }), offset)
        ),
        el('div', { class: 'grid-2' },
          el('div', { class: 'mini-field' }, el('span', { text: 'Volume' }), volume)
        )
      )
    );
  }

  wrap.append(...children);
  return wrap;
}

function numInput(value, min, max, onChange, step = 1) {
  return el('input', {
    type: 'number',
    min,
    max,
    step,
    value,
    onchange: (e) => {
      let v = Number(e.target.value);
      if (!Number.isFinite(v)) v = min;
      onChange(clamp(v, min, max));
    },
  });
}

function colorField(value, setValue) {
  const wrap = el('div', { class: 'color-field' });
  const picker = el('input', { type: 'color', value: normalizeHex(value) });
  const hex = el('input', { class: 'hex', type: 'text', value: normalizeHex(value), spellcheck: 'false' });

  picker.addEventListener('pointerdown', () => store.begin());
  picker.addEventListener('input', () => {
    hex.value = picker.value;
    setValue(picker.value);
    store.emit('transform');
  });
  picker.addEventListener('change', () => {
    setValue(picker.value);
    store.end();
    store.emit('project');
  });

  const commitHex = () => {
    const v = normalizeHex(hex.value);
    picker.value = v;
    hex.value = v;
    store.act(() => setValue(v));
    store.emit('project');
  };
  hex.addEventListener('change', commitHex);
  hex.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') hex.blur();
  });

  wrap.append(picker, hex);
  return wrap;
}

function normalizeHex(v) {
  if (!v) return '#000000';
  let s = String(v).trim();
  if (!s.startsWith('#')) s = '#' + s;
  if (!/^#[0-9a-fA-F]{6}$/.test(s)) {
    if (/^#[0-9a-fA-F]{3}$/.test(s)) {
      s = '#' + s.slice(1).split('').map((c) => c + c).join('');
    } else return '#000000';
  }
  return s.toLowerCase();
}

// ---------------------------------------------------------------------------
// Effects
// ---------------------------------------------------------------------------

function buildEffects(host, layer) {
  const listWrap = el('div');

  if (!layer.effects || !layer.effects.length) {
    listWrap.append(
      el('div', { class: 'empty-state', style: { padding: '16px 4px' }, text: 'No effects yet. Add one below.' })
    );
  }

  for (const ef of layer.effects || []) {
    listWrap.append(buildEffectCard(layer, ef));
  }

  host.append(section('Effects', listWrap));

  const select = el('select', { style: { flex: '1' } });
  for (const group of EFFECT_GROUPS) {
    const og = el('optgroup', { label: group });
    for (const [type, def] of Object.entries(EFFECT_DEFS)) {
      if (def.group !== group) continue;
      og.append(el('option', { value: type, text: def.label }));
    }
    select.append(og);
  }

  const addRow = el(
    'div',
    { style: { display: 'flex', gap: '6px', marginTop: '8px' } },
    select,
    el('button', {
      class: 'btn tiny',
      text: 'Add',
      onclick: () => {
        const ef = createEffect(select.value);
        if (!ef) return;
        store.act(() => {
          layer.effects.push(ef);
        });
        store.emit('project');
        toast(`${EFFECT_DEFS[ef.type].label} added`, 'ok', 1500);
      },
    })
  );

  host.append(el('div', { class: 'section' }, el('div', { class: 'section-title' }, el('span', { text: 'Add effect' })), addRow));
}

function buildEffectCard(layer, ef) {
  const def = EFFECT_DEFS[ef.type] || { label: ef.type, params: [] };
  const isCollapsed = collapsed.has(ef.id);

  const card = el('div', { class: 'fx-card' });

  const toggle = el('button', {
    class: `fx-toggle ${ef.enabled ? 'on' : ''}`,
    text: ef.enabled ? '●' : '○',
    title: 'Enable / disable effect',
    onclick: (e) => {
      e.stopPropagation();
      store.act(() => {
        ef.enabled = !ef.enabled;
      });
      store.emit('project');
    },
  });

  const remove = el('button', {
    class: 'fx-remove',
    text: '✕',
    title: 'Remove effect',
    onclick: (e) => {
      e.stopPropagation();
      store.act(() => {
        layer.effects = layer.effects.filter((x) => x.id !== ef.id);
      });
      // clean orphan keyframes
      for (const path of Object.keys(layer.keyframes || {})) {
        if (path.startsWith(`effect.${ef.id}.`)) delete layer.keyframes[path];
      }
      store.emit('project');
    },
  });

  const head = el(
    'div',
    {
      class: 'fx-head',
      onclick: () => {
        if (collapsed.has(ef.id)) collapsed.delete(ef.id);
        else collapsed.add(ef.id);
        store.emit('project');
      },
    },
    toggle,
    el('span', { class: 'fx-name', text: def.label }),
    remove
  );

  card.append(head);
  if (!isCollapsed) {
    const body = el('div', { class: 'fx-body' });

    for (const p of def.params) {
      const path = `effect.${ef.id}.${p.key}`;
      if (p.type === 'color') {
        const current = ef.params[p.key];
        body.append(
          el(
            'div',
            { class: 'field-inline' },
            el('span', { text: p.label }),
            colorField(current, (v) => {
              ef.params[p.key] = v;
            })
          )
        );
      } else {
        body.append(
          propRow(layer, path, {
            label: p.label,
            min: p.min,
            max: p.max,
            step: p.step,
          })
        );
      }
    }

    card.append(body);
  }

  return card;
}
