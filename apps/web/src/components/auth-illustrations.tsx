import type { ReactElement } from 'react';

/**
 * Illustrations for the sign-in carousel. Drawn as SVG so they ship with the app
 * (no image hosting, instant load, crisp on any screen). To use photos instead,
 * put images in apps/web/public/auth/ and pass `image` to the slides in auth-carousel.tsx.
 */

const C = {
  night: '#0c2a21',
  night2: '#143a2e',
  night3: '#1d4c3d',
  line: '#2b5e4c',
  mint: '#5fe0ad',
  mintSoft: '#bdf2dc',
  solder: '#10845f',
  paper: '#fcfcf9',
  ink: '#142019',
  grey: '#c9d3ce',
  amber: '#e3a008',
};

function Grid() {
  return (
    <g opacity="0.35">
      {Array.from({ length: 13 }, (_, i) => (
        <line key={`v${i}`} x1={i * 40} y1="0" x2={i * 40} y2="360" stroke={C.line} strokeWidth="1" />
      ))}
      {Array.from({ length: 10 }, (_, i) => (
        <line key={`h${i}`} x1="0" y1={i * 40} x2="480" y2={i * 40} stroke={C.line} strokeWidth="1" />
      ))}
    </g>
  );
}

/** A phone on the counter being scanned, with the receipt printing beside it. */
export function PosScene() {
  return (
    <svg viewBox="0 0 480 360" aria-hidden className="h-full w-full">
      <Grid />
      <rect x="20" y="276" width="440" height="60" rx="14" fill={C.night3} />
      <rect x="20" y="276" width="440" height="8" rx="4" fill={C.line} />
      {/* phone, back side with IMEI sticker */}
      <g transform="rotate(-8 175 190)">
        <rect x="118" y="96" width="112" height="196" rx="22" fill="#24584a" stroke={C.mint} strokeOpacity="0.35" strokeWidth="2" />
        <rect x="134" y="112" width="34" height="34" rx="10" fill={C.night} />
        <circle cx="151" cy="129" r="9" fill={C.night2} stroke={C.line} strokeWidth="2" />
        <rect x="134" y="206" width="80" height="54" rx="6" fill={C.paper} />
        {[0, 4, 7, 12, 15, 19, 24, 27, 31, 36, 40, 44, 49, 53, 58, 62].map((x, i) => (
          <rect key={i} x={140 + x} y="214" width={i % 3 === 0 ? 3 : 1.6} height="22" fill={C.ink} />
        ))}
        <rect x="140" y="242" width="56" height="5" rx="2" fill={C.grey} />
        <rect x="140" y="250" width="40" height="5" rx="2" fill={C.grey} />
      </g>
      {/* scanner beam and handheld scanner */}
      <polygon points="300,92 158,214 214,236" fill={C.amber} opacity="0.22" />
      <line x1="168" y1="226" x2="210" y2="240" stroke={C.amber} strokeWidth="3" strokeLinecap="round" />
      <g transform="rotate(28 330 90)">
        <rect x="292" y="66" width="86" height="44" rx="14" fill={C.paper} />
        <rect x="292" y="80" width="14" height="16" rx="4" fill={C.amber} />
        <rect x="346" y="100" width="28" height="70" rx="12" fill={C.paper} />
        <rect x="352" y="112" width="16" height="22" rx="6" fill={C.grey} />
      </g>
      {/* receipt strip */}
      <g>
        <path d="M330 120 h116 v150 l-9.6 8 -9.7 -8 -9.7 8 -9.6 -8 -9.7 8 -9.7 -8 -9.6 8 -9.7 -8 -9.7 8 -9.6 -8 -9.7 8 -9.7 -8 z" fill={C.paper} />
        <rect x="344" y="136" width="58" height="7" rx="3" fill={C.ink} />
        <rect x="344" y="152" width="86" height="5" rx="2" fill={C.grey} />
        <rect x="344" y="163" width="70" height="5" rx="2" fill={C.grey} />
        <rect x="344" y="174" width="78" height="5" rx="2" fill={C.grey} />
        <line x1="344" y1="192" x2="432" y2="192" stroke={C.grey} strokeDasharray="4 4" />
        <text x="344" y="208" fontFamily="'Atkinson Hyperlegible Next Variable', sans-serif" fontSize="10" fill="#7a857f">Total</text>
        <text x="344" y="228" fontFamily="'Atkinson Hyperlegible Mono', monospace" fontWeight="700" fontSize="15" fill={C.ink}>Rs 185,000</text>
        <circle cx="418" cy="252" r="12" fill={C.solder} />
        <path d="M411.5 252 l4.5 4.5 8.5-9.5" stroke={C.paper} strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </g>
      <rect x="318" y="112" width="140" height="12" rx="6" fill={C.night} />
    </svg>
  );
}

/** An opened phone on a repair mat, a screwdriver, and the job's station track. */
export function RepairScene() {
  const stations = [0, 1, 2, 3, 4, 5];
  return (
    <svg viewBox="0 0 480 360" aria-hidden className="h-full w-full">
      <Grid />
      <rect x="56" y="34" width="368" height="226" rx="20" fill={C.night3} />
      {Array.from({ length: 8 }, (_, i) => (
        <line key={i} x1={56 + 46 * i} y1="34" x2={56 + 46 * i} y2="260" stroke={C.line} strokeOpacity="0.6" />
      ))}
      {/* opened phone */}
      <rect x="128" y="62" width="110" height="176" rx="20" fill="#24584a" stroke={C.mint} strokeOpacity="0.4" strokeWidth="2" />
      <rect x="140" y="76" width="86" height="96" rx="8" fill={C.night} />
      <rect x="148" y="84" width="70" height="80" rx="6" fill={C.mint} opacity="0.85" />
      <rect x="160" y="94" width="46" height="8" rx="3" fill={C.night} opacity="0.5" />
      <rect x="140" y="182" width="40" height="44" rx="6" fill={C.night} />
      {[0, 1, 2].map((r) => [0, 1, 2].map((c) => <rect key={`${r}${c}`} x={146 + c * 11} y={188 + r * 12} width="7" height="7" rx="1.5" fill={C.line} />))}
      <rect x="188" y="182" width="38" height="44" rx="6" fill={C.amber} opacity="0.9" />
      {/* loose screen beside */}
      <g transform="rotate(10 312 140)">
        <rect x="262" y="66" width="100" height="160" rx="18" fill={C.night} stroke={C.line} strokeWidth="2" />
        <path d="M280 96 l26 30 -14 18 34 40" stroke={C.mintSoft} strokeOpacity="0.55" strokeWidth="2" fill="none" />
      </g>
      {/* screwdriver */}
      <g transform="rotate(-32 380 220)">
        <rect x="330" y="214" width="62" height="18" rx="9" fill={C.amber} />
        <rect x="392" y="220" width="60" height="6" rx="3" fill={C.grey} />
      </g>
      {/* station track */}
      <line x1="84" y1="304" x2="396" y2="304" stroke={C.line} strokeWidth="4" strokeLinecap="round" />
      <line x1="84" y1="304" x2="280" y2="304" stroke={C.mint} strokeWidth="4" strokeLinecap="round" />
      {stations.map((i) => {
        const x = 84 + i * 62.4;
        const done = i < 3;
        const here = i === 3;
        return (
          <g key={i}>
            {here && <circle cx={x} cy="304" r="15" fill={C.mint} opacity="0.2" />}
            <circle cx={x} cy="304" r="8" fill={done || here ? C.mint : C.night3} stroke={done || here ? C.mint : C.line} strokeWidth="2" />
          </g>
        );
      })}
    </svg>
  );
}

/** Stocked shelves, with a magnifier reading one box's IMEI label. */
export function StockScene() {
  const rows = [70, 150, 230];
  const widths = [[44, 44, 60, 44], [60, 44, 44, 52], [44, 52, 44, 60]];
  return (
    <svg viewBox="0 0 480 360" aria-hidden className="h-full w-full">
      <Grid />
      <rect x="40" y="40" width="300" height="280" rx="16" fill={C.night3} />
      {rows.map((y, r) => (
        <g key={r}>
          <rect x="52" y={y + 60} width="276" height="8" rx="4" fill={C.line} />
          {widths[r].reduce<{ x: number; els: ReactElement[] }>((acc, w, i) => {
            const fill = (r + i) % 3 === 0 ? C.paper : (r + i) % 3 === 1 ? '#24584a' : C.mintSoft;
            acc.els.push(
              <g key={i}>
                <rect x={acc.x} y={y} width={w} height="58" rx="6" fill={fill} />
                <rect x={acc.x + 8} y={y + 38} width={w - 16} height="10" rx="2" fill={fill === C.paper ? C.grey : C.night} opacity="0.5" />
              </g>,
            );
            acc.x += w + 10;
            return acc;
          }, { x: 64, els: [] }).els}
        </g>
      ))}
      {/* magnifier */}
      <line x1="388" y1="256" x2="438" y2="312" stroke={C.paper} strokeWidth="14" strokeLinecap="round" />
      <circle cx="340" cy="200" r="86" fill={C.night} stroke={C.paper} strokeWidth="10" />
      <rect x="276" y="168" width="128" height="68" rx="8" fill={C.paper} />
      {[0, 3, 5, 9, 12, 14, 18, 21, 25, 28, 30, 34, 38, 41, 45, 48, 52, 56, 59, 63, 67, 70, 74, 78, 81, 85, 89, 92, 96, 100, 104, 108].map((x, i) => (
        <rect key={i} x={286 + x} y="178" width={i % 4 === 0 ? 2.6 : 1.4} height="28" fill={C.ink} />
      ))}
      <text x="340" y="224" textAnchor="middle" fontFamily="'Atkinson Hyperlegible Mono', monospace" fontSize="11" fill={C.ink}>35 209900 176148 1</text>
    </svg>
  );
}

/** A customer's phone with the shop's "ready for pickup" SMS. */
export function TrackScene() {
  return (
    <svg viewBox="0 0 480 360" aria-hidden className="h-full w-full">
      <Grid />
      <rect x="150" y="18" width="180" height="330" rx="32" fill="#24584a" stroke={C.mint} strokeOpacity="0.4" strokeWidth="2" />
      <rect x="162" y="30" width="156" height="306" rx="24" fill={C.night} />
      <rect x="214" y="40" width="52" height="10" rx="5" fill="#24584a" />
      <rect x="176" y="70" width="128" height="22" rx="6" fill={C.night2} />
      <circle cx="190" cy="81" r="6" fill={C.mint} />
      <rect x="202" y="77" width="64" height="8" rx="3" fill={C.line} />
      {/* incoming SMS */}
      <rect x="176" y="108" width="122" height="96" rx="14" fill={C.paper} />
      <rect x="188" y="122" width="74" height="7" rx="3" fill={C.ink} />
      <rect x="188" y="137" width="96" height="6" rx="3" fill={C.grey} />
      <rect x="188" y="149" width="88" height="6" rx="3" fill={C.grey} />
      <rect x="188" y="161" width="92" height="6" rx="3" fill={C.grey} />
      <rect x="188" y="180" width="60" height="12" rx="6" fill={C.mintSoft} />
      {/* reply */}
      <rect x="214" y="218" width="90" height="40" rx="14" fill={C.solder} />
      <rect x="226" y="231" width="62" height="6" rx="3" fill={C.paper} opacity="0.85" />
      <rect x="226" y="242" width="40" height="6" rx="3" fill={C.paper} opacity="0.85" />
      {/* ready badge */}
      <circle cx="344" cy="112" r="34" fill={C.mint} />
      <path d="M329 112 l10 10 20-22" stroke={C.night} strokeWidth="6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      {/* signal waves */}
      <path d="M100 150 a40 40 0 0 1 0 60" stroke={C.mint} strokeOpacity="0.5" strokeWidth="4" fill="none" strokeLinecap="round" />
      <path d="M78 132 a66 66 0 0 1 0 96" stroke={C.mint} strokeOpacity="0.25" strokeWidth="4" fill="none" strokeLinecap="round" />
    </svg>
  );
}
