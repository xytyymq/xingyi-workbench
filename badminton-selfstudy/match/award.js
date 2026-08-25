/* award.js — 星羿赛事统一颁奖/榜单图模块（SVG -> PNG，浏览器/Node 双用）
 * 合并：个人前三（双瑞士/八人转/大乱斗）、团队前三（团体赛）、常驻榜海报（大乱斗）
 * theme: { bg1, bg2, accent, accent2, footer }
 */
(function (global) {
  'use strict';

  function escapeXml(s) {
    return String(s).replace(/[<>&'"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]));
  }

  // 个人前三名颁奖图
  function buildAwardSVG(top3, opts) {
    opts = opts || {};
    const t = THEMES[opts.theme] || THEMES.default;
    const title = opts.title || '羽毛球赛 · 最终排名';
    const date = opts.date || '';
    const venue = opts.venue || '星羿羽毛球馆 · 九江开发区';
    const W = 1080, H = 1350;
    const deck = [
      { x: 340, y: 650, w: 400, h: 470, c: '#C9A24B' },
      { x: 90, y: 810, w: 340, h: 310, c: '#9AA7B4' },
      { x: 650, y: 810, w: 340, h: 310, c: '#B5793B' }
    ];
    const label = ['冠军', '亚军', '季军'];
    let cards = '';
    top3.slice(0, 3).forEach((p, i) => {
      const d = deck[i];
      const name = (p && p.name) ? p.name : '—';
      const sub = (p && p.wins !== undefined)
        ? `胜 ${p.wins} · 净胜分 ${p.net}`
        : (p && p.pts !== undefined ? `积分 ${p.pts}` : '');
      const tag = label[i];
      cards += `
      <rect x="${d.x}" y="${d.y}" width="${d.w}" height="${d.h}" rx="22" fill="${d.c}"/>
      <rect x="${d.x}" y="${d.y}" width="${d.w}" height="14" rx="7" fill="rgba(255,255,255,.35)"/>
      <circle cx="${d.x + d.w / 2}" cy="${d.y - 66}" r="78" fill="#fff" stroke="#1f2d22" stroke-width="4"/>
      <text x="${d.x + d.w / 2}" y="${d.y - 42}" font-size="74" font-weight="800" text-anchor="middle" fill="#1f2d22" letter-spacing="1">${i + 1}</text>
      <text x="${d.x + d.w / 2}" y="${d.y + 78}" font-size="46" font-weight="800" text-anchor="middle" fill="#1f2d22" letter-spacing="8">${escapeXml(tag)}</text>
      <line x1="${d.x + 40}" y1="${d.y + 104}" x2="${d.x + d.w - 40}" y2="${d.y + 104}" stroke="rgba(31,45,34,.35)" stroke-width="2"/>
      <text x="${d.x + d.w / 2}" y="${d.y + 168}" font-size="44" font-weight="700" text-anchor="middle" fill="#1f2d22" letter-spacing="3">${escapeXml(name)}</text>
      <text x="${d.x + d.w / 2}" y="${d.y + 222}" font-size="28" text-anchor="middle" fill="#3a2f15" letter-spacing="1">${escapeXml(sub)}</text>`;
    });
    const racket = (cx, cy, rot, col) => `
      <g transform="translate(${cx},${cy}) rotate(${rot})">
        <ellipse cx="0" cy="-46" rx="46" ry="62" fill="none" stroke="${col}" stroke-width="9"/>
        <line x1="0" y1="16" x2="0" y2="120" stroke="${col}" stroke-width="11" stroke-linecap="round"/>
      </g>`;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
      <defs><linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${t.bg1}"/><stop offset="1" stop-color="${t.bg2}"/></linearGradient></defs>
      <rect width="${W}" height="${H}" fill="url(#bg)"/>
      ${racket(150, 150, -22, t.accent)}${racket(930, 150, 22, t.accent2)}
      <text x="${W / 2}" y="96" font-size="34" font-weight="600" text-anchor="middle" fill="${t.accent}" letter-spacing="6">⭐ 星羿羽毛球馆 · 未来赛事板块</text>
      <text x="${W / 2}" y="180" font-size="78" font-weight="900" text-anchor="middle" fill="#ffffff" letter-spacing="4">${escapeXml(title)}</text>
      <text x="${W / 2}" y="236" font-size="32" text-anchor="middle" fill="${t.accent2}" letter-spacing="3">${escapeXml(opts.tag || '以球会友 · 积分常驻')}</text>
      <line x1="360" y1="268" x2="720" y2="268" stroke="${t.accent}" stroke-width="3" stroke-opacity=".5"/>
      ${cards}
      <rect x="0" y="${H - 120}" width="${W}" height="120" fill="rgba(0,0,0,.22)"/>
      <text x="${W / 2}" y="${H - 70}" font-size="34" text-anchor="middle" fill="#cfe9d8" letter-spacing="2">${escapeXml(date)}</text>
      <text x="${W / 2}" y="${H - 30}" font-size="28" text-anchor="middle" fill="#8fb7a3" letter-spacing="1">${escapeXml(venue)}</text>
    </svg>`;
  }

  // 常驻榜 / 积分榜海报（前 N 名横向榜单）
  function buildBoardSVG(board, opts) {
    opts = opts || {};
    const t = THEMES[opts.theme] || THEMES.default;
    const title = opts.title || '积分常驻榜';
    const scope = opts.scope || '';
    const rows = (board || []).slice(0, 12);
    const W = 1080, rowH = 78, top = 300, H = top + rows.length * rowH + 160;
    let body = '';
    rows.forEach((p, i) => {
      const y = top + i * rowH;
      const bg = i % 2 ? t.bg1 : t.bg2;
      body += `
        <rect x="60" y="${y}" width="960" height="${rowH - 8}" rx="12" fill="${bg}"/>
        <text x="100" y="${y + 50}" font-size="38" font-weight="800" text-anchor="middle" fill="${i < 3 ? t.accent2 : t.accent}">${i + 1}</text>
        <text x="170" y="${y + 50}" font-size="38" font-weight="700" fill="#fff">${escapeXml(p.name)}</text>
        <text x="560" y="${y + 50}" font-size="34" fill="#cfe9d8">胜 ${p.wins} / 负 ${p.losses}</text>
        <text x="800" y="${y + 50}" font-size="34" fill="#cfe9d8">净胜 ${p.net}</text>
        <text x="1000" y="${y + 50}" font-size="30" text-anchor="end" fill="#8fb7a3">${p.events}场</text>`;
    });
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
      <defs><linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${t.bg1}"/><stop offset="1" stop-color="${t.bg2}"/></linearGradient></defs>
      <rect width="${W}" height="${H}" fill="url(#bg)"/>
      <text x="${W / 2}" y="92" font-size="38" font-weight="700" text-anchor="middle" fill="${t.accent}" letter-spacing="2">⭐ 星羿羽毛球馆 · 未来赛事板块</text>
      <text x="${W / 2}" y="170" font-size="68" font-weight="900" text-anchor="middle" fill="#ffffff">${escapeXml(title)}</text>
      <text x="${W / 2}" y="226" font-size="34" text-anchor="middle" fill="${t.accent2}">${escapeXml(scope)}</text>
      ${body}
      <text x="${W / 2}" y="${H - 50}" font-size="28" text-anchor="middle" fill="#8fb7a3">星羿羽毛球馆 · 九江开发区 ｜ 每周开战，等你来战</text>
    </svg>`;
  }

  const THEMES = {
    default: { bg1: '#16324a', bg2: '#0c1b29', accent: '#7fd1c4', accent2: '#FFD23F' },
    doubleswiss: { bg1: '#16324a', bg2: '#0c1b29', accent: '#7fd1c4', accent2: '#FFD23F' },
    octa: { bg1: '#1a2f1e', bg2: '#0c1b12', accent: '#9bdc8f', accent2: '#FFD23F' },
    brawl: { bg1: '#16352a', bg2: '#0d1f18', accent: '#3fae7a', accent2: '#f5a623' },
    team: { bg1: '#16352a', bg2: '#0d1f18', accent: '#3fae7a', accent2: '#f5a623' },
    regular: { bg1: '#1c3a2e', bg2: '#0d1f18', accent: '#46b886', accent2: '#FFD23F' }
  };

  // 浏览器：SVG 字符串 -> PNG 下载
  function downloadPNG(svg, filename) {
    const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = function () {
      const canvas = document.createElement('canvas');
      const view = img.width || 1080;
      canvas.width = view; canvas.height = img.height || 1350;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);
      URL.revokeObjectURL(url);
      canvas.toBlob(function (png) {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(png);
        a.download = filename || ('星羿赛事_' + Date.now() + '.png');
        a.click();
      }, 'image/png');
    };
    img.src = url;
  }

  const API = { buildAwardSVG, buildBoardSVG, downloadPNG, THEMES };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else global.Award = API;
})(typeof window !== 'undefined' ? window : globalThis);
