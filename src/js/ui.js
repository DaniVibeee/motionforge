// Small DOM / UI helpers

export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const child of children.flat()) {
    if (child == null || child === false) continue;
    node.append(child.nodeType ? child : document.createTextNode(String(child)));
  }
  return node;
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function toast(message, type = '', ms = 2800) {
  const host = document.getElementById('toasts');
  if (!host) return;
  const node = el('div', { class: `toast ${type}`, text: message });
  host.append(node);
  setTimeout(() => {
    node.style.transition = 'opacity .2s, transform .2s';
    node.style.opacity = '0';
    node.style.transform = 'translateY(6px)';
    setTimeout(() => node.remove(), 220);
  }, ms);
}

export function typeIcon(type) {
  return (
    {
      text: 'T',
      image: '▣',
      video: '▶',
      shape: '◆',
      solid: '■',
    }[type] || '•'
  );
}

export function debounce(fn, ms = 120) {
  let t = null;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

let ctxCleanup = null;

export function contextMenu(x, y, items) {
  const menu = document.getElementById('ctxMenu');
  if (!menu) return;
  menu.innerHTML = '';
  for (const item of items) {
    if (item.sep) {
      menu.append(el('div', { class: 'sep' }));
      continue;
    }
    menu.append(
      el('button', {
        class: item.danger ? 'danger' : '',
        text: item.label,
        onclick: () => {
          hideContextMenu();
          item.action();
        },
      })
    );
  }
  menu.hidden = false;
  const rect = menu.getBoundingClientRect();
  menu.style.left = `${Math.min(x, window.innerWidth - rect.width - 8)}px`;
  menu.style.top = `${Math.min(y, window.innerHeight - rect.height - 8)}px`;

  if (ctxCleanup) ctxCleanup();
  const close = (e) => {
    if (!menu.contains(e.target)) hideContextMenu();
  };
  const key = (e) => {
    if (e.key === 'Escape') hideContextMenu();
  };
  setTimeout(() => {
    window.addEventListener('pointerdown', close, { once: true });
    window.addEventListener('keydown', key, { once: true });
  }, 0);
  ctxCleanup = () => {
    window.removeEventListener('pointerdown', close);
    window.removeEventListener('keydown', key);
    ctxCleanup = null;
  };
}

export function hideContextMenu() {
  const menu = document.getElementById('ctxMenu');
  if (menu) menu.hidden = true;
  if (ctxCleanup) ctxCleanup();
}

export const PATHS_COLORS = ['#7c9cff', '#ff7ab6', '#59e2b4', '#ffc857', '#b48cff', '#ff8a5c', '#4fd1ff', '#ff6b6b', '#9be15d'];
